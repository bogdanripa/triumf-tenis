// lib/safe-json.ts
export function safeJson(obj: any) {
    return JSON.parse(JSON.stringify(obj));
}