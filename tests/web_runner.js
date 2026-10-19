// Runs one function of web/model.js for tests/test_web.py.
// Reads {"fn": name, "args": [...]} on stdin, prints the result as JSON.
"use strict";
const path = require("path");
const M = require(path.join(__dirname, "..", "web", "model.js"));

let input = "";
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const req = JSON.parse(input);
  let out;
  if (req.fn === "prompt") {
    const p = new M.PromptParser();
    const events = req.args[0].map((line) => p.feed(line));
    out = { events, shown: p.shown };
  } else {
    out = M[req.fn].apply(null, req.args);
  }
  process.stdout.write(JSON.stringify(out));
});
