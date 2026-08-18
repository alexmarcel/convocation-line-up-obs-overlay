"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {matchRank,searchStudents}=require("../src/scanner-search");

const library={
  order:["AB12","AB123","42","7","9","10","11","12","13","14","15","16","17"],
  students:{
    AB12:{name:"Zara Lim",group:"Engineering"},
    AB123:{name:"Alpha",group:"Arts"},
    42:{name:"AB12",group:"Science"},
    7:{name:"Zara Khan",group:"Law"},
    9:{name:"Khan Zara",group:"Law"},
    10:{name:"Another Zara",group:"Law"},
    11:{name:"ZARA Eleven",group:"Law"},
    12:{name:"Zara Twelve",group:"Law"},
    13:{name:"Zara Thirteen",group:"Law"},
    14:{name:"Zara Fourteen",group:"Law"},
    15:{name:"Zara Fifteen",group:"Law"},
    16:{name:"Zara Sixteen",group:"Law"},
    17:{name:"Zara Seventeen",group:"Law"}
  }
};

test("scanner search ranks exact ID, ID prefix, exact name, name prefix and substring",()=>{
  assert.equal(matchRank("AB12",library.students.AB12,"ab12"),0);
  assert.equal(matchRank("AB123",library.students.AB123,"ab12"),1);
  assert.equal(matchRank("42",library.students["42"],"ab12"),2);
  assert.equal(matchRank("7",library.students["7"],"zara"),3);
  assert.equal(matchRank("9",library.students["9"],"zara"),4);
  assert.deepEqual(searchStudents(library,"AB12").map(item=>item.id),["AB12","AB123","42"]);
});

test("scanner search is case-insensitive, preserves CSV order and limits results",()=>{
  const results=searchStudents(library,"  ZaRA  ");
  assert.equal(results.length,10);
  assert.deepEqual(results.slice(0,4).map(item=>item.id),["AB12","7","11","12"]);
});

test("scanner search handles partial IDs, partial names and empty/no matches",()=>{
  assert.deepEqual(searchStudents(library,"123").map(item=>item.id),["AB123"]);
  assert.deepEqual(searchStudents(library,"khan").map(item=>item.id),["9","7"]);
  assert.deepEqual(searchStudents(library,""),[]);
  assert.deepEqual(searchStudents(library,"not present"),[]);
  assert.deepEqual(searchStudents(null,"zara"),[]);
});
