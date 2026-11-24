// continuation.js
// When a streamed reply breaks partway (the provider drops the connection), the text that already
// arrived is kept. The retry sends the original request plus that partial reply and asks the model
// to continue from the exact point it stopped, and the two pieces are joined.

import { AIMessage, HumanMessage } from "@langchain/core/messages";

// Shorter partial replies are not worth continuing; the retry just starts over.
export const minContinueChars = 200;

const continueInstruction = `Your previous reply was cut off by a network error. Continue it from the exact character
where it stopped. Do not repeat anything already written, do not restart the code block, and do not add any
introduction or commentary: your output is appended directly to the text above. Close any open code block when
you finish.`;

export function continuationMessages(messages, partial) {
  return [...messages, new AIMessage(partial), new HumanMessage(continueInstruction)];
}

// Appends a continuation to a partial reply. Models sometimes reopen the code block or repeat the
// last few lines before carrying on, so a reopened fence and any repeated overlap are removed.
export function joinContinuation(partial, more) {
  let next = String(more ?? "");
  const fences = (partial.match(/```/g) ?? []).length;
  if (fences % 2 === 1) next = next.replace(/^\s*```[\w-]*[ \t]*\n/, "");
  // Longest suffix of partial that the continuation starts with (at least 20 characters, so a
  // short coincidental match such as "}\n" is not removed).
  const max = Math.min(partial.length, next.length, 4000);
  for (let k = max; k >= 20; k--) {
    if (partial.endsWith(next.slice(0, k))) return partial + next.slice(k);
  }
  return partial + next;
}
