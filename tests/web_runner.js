// Runs one function of web/model.js or web/qr.js for the tests.
// Reads {"fn": name, "args": [...]} on stdin, prints the result as JSON.
"use strict";
const path = require("path");
const M = Object.assign({}, require(path.join(__dirname, "..", "web", "model.js")),
                        require(path.join(__dirname, "..", "web", "qr.js")));

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
