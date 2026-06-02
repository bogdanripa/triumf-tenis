import { revalidatePath } from 'next/cache';
import { clearSchedule, addToSchedule } from '@/lib/db';
import { downloadExcelFile } from '@/lib/googleDrive';
import * as XLSX from 'xlsx';

export const months = ["IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE", "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE"];
export const days = ["DUMINICA", "LUNI", "MARTI", "MIERCURI", "JOI", "VINERI", "SAMBATA"];

// Remove bidi/zero-width formatting marks (U+202A..U+202E, U+200E, U+200F,
// U+2066..U+2069) that sneak into copy-pasted spreadsheet cells. Written with
// numeric code points to avoid embedding invisible characters in source.
export function stripFormatting(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if ((c >= 0x202A && c <= 0x202E) || c === 0x200E || c === 0x200F || (c >= 0x2066 && c <= 0x2069)) {
      continue;
    }
    out += ch;
  }
  return out;
}

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
  const range = `${col1}${line+1}:${col2}${line+17}`;
  const json:any = XLSX.utils.sheet_to_json(sheet, { header: 1, range });
  for(let i = 0; i < json.length; i++) {
    // End the day block at the first empty Teren 1 cell. A non-string value
    // (e.g. a number or a date-coerced "10-11" slot) counts as non-empty.
    const first = json[i][0];
    const isEmpty = json[i].length == 0 || first == null || (typeof first === 'string' && first.trim() == '');
    if (isEmpty) {
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
  for(let teren = 0; teren < json.length; teren++) {
    if(json[teren].length > 0) {
      for (let interval=0;interval<json[teren].length;interval++) {
        if (json[teren][interval].match) {
          const clean = stripFormatting(json[teren][interval]);
          const ret = clean.match(/([\d:]+)-([\d:]+)(.*)$/);
          if(ret) {
            if (ret[3].trim() == "" || ret[3].trim().match(/x$/i)) {
              // empty slot
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
              schedules[interval][k] = 1;
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
  const schedule = [];
  const sheet = workbook.Sheets[sheetName];
  if (sheet) {
    const header1 = findCellAddressByValue(sheet, `${dayOfWeek} ${day}`);
    if (header1) {
      const data = getScheduleFrom(sheet, header1[0], header1[1]);
      for (let i=0;i<data.length;i++) {
        for (const [time, state] of Object.entries(data[i])) {
          schedule.push({dayIdx, location: i, dayOfWeek, time: parseInt(time), state})
        }
      }
    }
  } else {
    console.error(`Sheet "${sheetName}" not found`);
  }
  return schedule;
}

function explodeDate(today: Date) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = `${today.getDate()}`.padStart(2, '0');
  const dayOfWeek = days[today.getDay()];
  return { year, month, day, dayOfWeek };
}

// Parse today + the next 2 days out of the workbook, replace the MongoDB
// schedule with the result, and revalidate the home page cache.
export async function importSchedule(workbook: XLSX.WorkBook) {
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
        // looking for the entry in the previous month
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
}

// Download the latest sheet from Drive and re-import it into MongoDB.
export async function refreshSchedule() {
  const buffer = await downloadExcelFile(process.env.GOOGLE_SPREADSHEET_ID);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  await importSchedule(workbook);
}
