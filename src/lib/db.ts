import mongoose from 'mongoose';
import { safeJson } from "@/lib/safeJson";

const MONGODB_URI = process.env["MY_MONGO_DB_DATABASE_URL"] || '';

if (!MONGODB_URI) {
  throw new Error('Please define the MY_MONGO_DB_DATABASE_URL environment variable');
}

// Avoid multiple connections during development with hot-reload
let cached = (global as any).mongoose || { conn: null, promise: null };

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI).then((mongoose) => mongoose);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// Define your schema and model
const s = new mongoose.Schema({
  location: Number,
  dayIdx: Number,
  dayOfWeek: String,
  time: Number,
  state: Number
});

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', s);

export async function addToSchedule(schedule: Array<{location: number, dayOfWeek: string, time: number, state: number}>) {
  await connectToDatabase();
  return Schedule.insertMany(schedule);
}

export async function clearSchedule(dayOfWeek:string | undefined = undefined) {
  await connectToDatabase();
  if (dayOfWeek)
    return Schedule.deleteMany({dayOfWeek});
  return Schedule.deleteMany({});
}

export async function getSchedule() {
  await connectToDatabase();
  const data = await Schedule.find({}).sort({ dayIdx: 1 }).lean();
  return safeJson(data);
}