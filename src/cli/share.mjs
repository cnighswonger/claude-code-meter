import { buildSharePayload } from "../share/payload-builder.mjs";
import { submitPayload } from "../share/client.mjs";

/**
 * Interactive share command — shows payload, asks for confirmation, submits.
 */
export async function shareCommand(args) {
  const { payload, valid, errors } = buildSharePayload(
    args.session || null,
    args.plan || "unknown",
  );

  if (!valid) {
    console.log("Could not build a valid share payload:");
    for (const e of errors) console.log(`  - ${e}`);
    return;
  }

  console.log("The following anonymized data will be shared:\n");
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    "\nThis contains ONLY numeric usage metrics. No prompts, code, file paths,",
    "or identifying information.\n",
  );

  // In non-interactive mode (--yes flag), skip confirmation
  if (!args.yes) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
      rl.question("Submit to community dataset? [y/N] ", resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  try {
    const result = await submitPayload(payload);
    if (result.ok) {
      console.log("Submitted successfully. Thank you for contributing!");
    } else {
      console.log(`Submission failed (${result.status}): ${result.body}`);
    }
  } catch (e) {
    console.log(`Error submitting: ${e.message}`);
  }
}
