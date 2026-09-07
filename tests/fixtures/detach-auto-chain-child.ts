import { fileURLToPath } from "node:url";
import { FakeAdapter, fakeCapabilities } from "../../src/adapters/fake.ts";
import { main } from "../../src/cli/main.ts";
import { declareImplementationReady, passResult, testDeps } from "../helpers.ts";

let reviews = 0;
const source = {
  result: () => {
    reviews += 1;
    return reviews === 1 ? passResult("plan") : passResult("implementation");
  },
};

const deps = testDeps({
  createAdapter: () =>
    new FakeAdapter(source, fakeCapabilities(), null, {
      mutate: async (input) => {
        await declareImplementationReady(input.workspace_root, input.task_path);
      },
    }),
});

const reviewIndex = process.argv.indexOf("review");
const cliArgs = reviewIndex >= 0 ? process.argv.slice(reviewIndex) : process.argv.slice(2);
const code = await main(cliArgs, process.env, fileURLToPath(import.meta.url), { deps });
process.exit(code);
