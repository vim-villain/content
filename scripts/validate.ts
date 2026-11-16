import { compileContent } from "./lib/compile.js";
import {
  Collector,
  ValidationFailure,
  formatValidationError,
} from "./lib/errors.js";
import { loadContent } from "./lib/load.js";

const collector = new Collector();
const raw = loadContent(collector);
if (!collector.failed) {
  try {
    compileContent(raw, collector);
  } catch (error) {
    if (!(error instanceof ValidationFailure)) {
      throw error;
    }
    for (const validationError of error.errors) {
      console.error(formatValidationError(validationError));
    }
    process.exit(1);
  }
} else {
  for (const validationError of collector.errors) {
    console.error(formatValidationError(validationError));
  }
  process.exit(1);
}

console.log(`validate: ${raw.files.length} files OK`);
