import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without this, a component left mounted by one test is still in the document
// when the next one queries it, and the failure surfaces somewhere unrelated.
afterEach(cleanup);
