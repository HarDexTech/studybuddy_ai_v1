import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkDocument,
  createChunkRotator,
  gradeFillInTheBlank,
} from "../src/lib/utils";

test("chunkDocument returns balanced paragraph groups", () => {
  const chunks = chunkDocument(
    "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.",
    2,
  );

  assert.deepEqual(chunks, [
    "First paragraph.\n\nSecond paragraph.",
    "Third paragraph.\n\nFourth paragraph.",
  ]);
});

test("chunkDocument handles blank input and caps the requested count", () => {
  assert.deepEqual(chunkDocument("  \n\n ", 3), []);
  assert.deepEqual(chunkDocument("One\n\nTwo", 10), ["One", "Two"]);
});

test("createChunkRotator visits every chunk before repeating", () => {
  const nextChunk = createChunkRotator("One\n\nTwo\n\nThree", 3);

  assert.deepEqual(
    [nextChunk(), nextChunk(), nextChunk(), nextChunk()],
    ["One", "Two", "Three", "One"],
  );
});

test("gradeFillInTheBlank accepts normalized and reordered equivalent answers", () => {
  assert.deepEqual(gradeFillInTheBlank("  Paris! ", "Paris"), {
    isCorrect: true,
    score: 100,
    feedback: "Correct!",
  });
  assert.deepEqual(gradeFillInTheBlank("blue sky", "sky blue"), {
    isCorrect: true,
    score: 100,
    feedback: "Correct!",
  });
});

test("gradeFillInTheBlank returns a score and feedback for an incorrect short answer", () => {
  const result = gradeFillInTheBlank("Rome", "Paris");

  assert.ok(result);
  assert.equal(result.isCorrect, false);
  assert.equal(result.score, 0);
  assert.match(result.feedback, /Paris/);
});

test("gradeFillInTheBlank defers long sentence-shaped answers", () => {
  assert.equal(
    gradeFillInTheBlank(
      "This is a long explanation that should be evaluated semantically",
      "Paris",
    ),
    null,
  );
});
