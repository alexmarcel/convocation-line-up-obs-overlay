"use strict";

function parseRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.trim()));
}

function parseStudents(text) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const required = ["id", "name", "group", "marks"];
  const indexes = Object.fromEntries(required.map((key) => [key, headers.indexOf(key)]));
  const missing = required.filter((key) => indexes[key] < 0);
  if (missing.length) throw new Error(`Missing CSV headers: ${missing.join(", ")}`);
  const students = {};
  const order = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const student = Object.fromEntries(required.map((key) => [key, (row[indexes[key]] || "").trim()]));
    if (!student.id || !student.name || !student.group || !student.marks) {
      throw new Error(`CSV row ${index + 1} has an empty required value.`);
    }
    if (students[student.id]) throw new Error(`Duplicate student ID "${student.id}" on row ${index + 1}.`);
    students[student.id] = student;
    order.push(student.id);
  }
  if (!order.length) throw new Error("CSV contains no student records.");
  return { students, order };
}

module.exports = { parseRows, parseStudents };
