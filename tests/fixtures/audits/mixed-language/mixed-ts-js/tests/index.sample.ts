import { main } from "../src/index.js";

test("main returns a greeting", () => {
  expect(main("world")).toContain("world");
});
