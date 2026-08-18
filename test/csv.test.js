"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRows, parseStudents } = require("../src/csv");

test("parseRows supports commas, quotes and newlines inside quoted fields", () => {
  assert.deepEqual(parseRows('id,name\n1,"Smith, Jane"\n2,"A ""quoted"" name"\n3,"two\nlines"'), [
    ["id","name"],["1","Smith, Jane"],["2",'A "quoted" name'],["3","two\nlines"]
  ]);
});

test("parseStudents validates and indexes required records", () => {
  const result = parseStudents("id,name,group,marks\n001,Jane Doe,Blue,98%");
  assert.equal(result.students["001"].name, "Jane Doe");
  assert.deepEqual(result.order, ["001"]);
});

test("parseStudents rejects missing headers, empty fields and duplicate IDs", () => {
  assert.throws(() => parseStudents("id,name\n1,A"), /Missing CSV headers/);
  assert.throws(() => parseStudents("id,name,group,marks\n1,A,,90"), /empty required value/);
  assert.throws(() => parseStudents("id,name,group,marks\n1,A,G,90\n1,B,G,91"), /Duplicate student ID/);
});
