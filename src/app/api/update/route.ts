import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { clearSchedule, addToSchedule } from '@/lib/db';
import { downloadExcelFile } from '@/lib/googleDrive';
import * as XLSX from 'xlsx';

const months = ["IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE", "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE"];
const days = ["LUNI", "MARTI", "MIERCURI", "JOI", "VINERI", "SAMBATA", "DUMINICA"];

function findCellAddressByValue(sheet: XLSX.WorkSheet, searchValue: string): [string, number] | null {
  const cellAddresses = Object.keys(sheet);

  for (const address of cellAddresses) {
    if (address.startsWith('!')) continue; // skip metadata keys like !ref, !margins

    const cell = sheet[address];
    if (cell && cell.v === searchValue) {
      return [address.replace(/[\d]+/, ''), parseInt(address.replace(/[^\d]+/, ''))]; // e.g., 'B4'
    }
  }

  return null; // not found
}

function getMinMax(json:any) {
  let hMin = 60*24, hMax = 0;
  for(let i = 0; i < json.length; i++) {
      if(json[i].length > 0) {
          for (let j=0;j<json[i].length;j++) {
              if (json[i][j].match) {
                  const ret = json[i][j].match(/([\d:]+)-([\d:]+)(.*)$/);
                  if(ret) {
                      for (let k=1; k<3; k++) {
                          let time;
                          if (ret[k].includes(":")) {
                              time = 60*parseInt(ret[k].split(":")[0]) + parseInt(ret[k].split(":")[1]);
                          } else {
                              time = 60*parseInt(ret[k]);
                          }
                          if (time < hMin) {
                              hMin = time;
                          }
                          if (time > hMax) {
                              hMax = time;
                          }
                      }
                  }
              }
          }
      }
  }
  //hMax -= 30;
  return [hMin, hMax];
}

function incrementColumn(col: string): string {
  let carry = 1;
  const chars = col.toUpperCase().split('').reverse();

  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) - 65; // A = 0, B = 1, ..., Z = 25
    const newCode = code + carry;

    if (newCode >= 26) {
      chars[i] = 'A';
      carry = 1;
    } else {
      chars[i] = String.fromCharCode(newCode + 65);
      carry = 0;
      break;
    }
  }

  if (carry === 1) {
    chars.push('A');
  }

  return chars.reverse().join('');
}

function getScheduleFrom(sheet: XLSX.WorkSheet, col1:string, line:number) {
  const col2 = incrementColumn(col1);
  const range = `${col1}${line+1}:${col2}${line+20}`;
  console.log(range);
  const json:any = XLSX.utils.sheet_to_json(sheet, { header: 1, range });
  for(let i = 0; i < json.length; i++) {
    if (json[i].length == 0 || !json[i][0].includes("-")) {
      json.splice(i);
      break;
    }
  }
  const [min, max] = getMinMax(json);
  const schedules: Array<Record<number, number>> = [{}, {}];
  for (let i=0; i<2; i++) {
      for (let j=min; j<max; j+=30) {
          schedules[i][j] = 0;
      }
  }
  for(let i = 0; i < json.length; i++) {
    if(json[i].length > 0) {
      for (let j=0;j<json[i].length;j++) {
        if (json[i][j].match) {
          const ret = json[i][j].match(/([\d:]+)-([\d:]+)(.*)$/);
          if(ret) {
            if (ret[3].trim() == "") {
                continue;
            }
            const from = ret[1];
            const to = ret[2];
            let fromTime, toTime;
            if (from.includes(":")) {
              fromTime = 60*parseInt(from.split(":")[0]) + parseInt(from.split(":")[1]);
            } else {
              fromTime = 60*parseInt(from);
            }
            if (to.includes(":")) {
              toTime = 60*parseInt(to.split(":")[0]) + parseInt(to.split(":")[1]);
            } else {
              toTime = 60*parseInt(to);
            }
            for (let k=fromTime; k<toTime; k+=30) {
              schedules[j][k] = 1;
            }
          }
        }
      }
    }
  }

  return schedules;
}

function getDaySchedule(dayIdx: Number, workbook:XLSX.WorkBook, monthNo: number, year: number, dayOfWeek: string, day: string) {
  const month = months[monthNo];
  const sheetName = `${month} ${year}`;
  const sheet = workbook.Sheets[sheetName];
  const header1 = findCellAddressByValue(sheet, `${dayOfWeek} ${day}`);
  const schedule = [];
  if (header1) {
    const data = getScheduleFrom(sheet, header1[0], header1[1]);
    for (let i=0;i<data.length;i++) {
      for (const [time, state] of Object.entries(data[i])) {
        schedule.push({dayIdx, location: i, dayOfWeek, time: parseInt(time), state})
      }
    }
  }
  return schedule;
}

function explodeDate(today: Date) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = `${today.getDate()}`.padStart(2, '0');
  const dayOfWeek = days[today.getDay()-1];
  return { year, month, day, dayOfWeek };
}

export async function GET(req: NextRequest) {  
  const excelBuffer = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });

  const schedule = [];

  for (let i=0;i<3;i++) {
    let d = new Date();
    d.setDate(d.getDate() + i);
    const {year, month, day, dayOfWeek} = explodeDate(d);
    let dailySchedule = getDaySchedule(i, workbook, month, year, dayOfWeek, day);
    if (dailySchedule.length == 0) {
      // not found on the current sheet, try to find it on the previous or next sheet
      let nm = month;
      let ny = year;
      if (d.getDate() < 15) {
        // looking fo the entry in the previous month
        nm--;
        if (nm<0) { 
          nm=11;
          ny--;
        }
      } else {
        // looking for the entry in the next month
        nm++;
        if (nm>11) {
          nm=0;
          ny++;
        }
      }
      dailySchedule = getDaySchedule(i, workbook, nm, ny, dayOfWeek, day);
    }
    if (dailySchedule.length == 0) {
      console.error(`No schedule found for ${dayOfWeek} ${day}`);
    }

    schedule.push(...dailySchedule);
  }
  await clearSchedule();
  await addToSchedule(schedule);
  revalidatePath('/');

  return NextResponse.json({ status: "ok" });
}