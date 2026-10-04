# **App Name**: StudyBuddy AI

## Core Features:

- Document Upload: Allow users to upload study documents in PDF, Word, and PPTX formats.
- Test Generation: Generate tests from uploaded documents. Test formats include multiple choice, fill-in-the-blank, and short answer.
- Question Type Selection: Allow users to choose the type of questions for the generated test (multiple choice, fill-in-the-blank, theory).
- Answer Validation Tool: Compare user-provided answers to the content in the uploaded documents and provide feedback on accuracy.
- Test Simulation UI: Provide a user-friendly interface for taking simulated tests, displaying questions and answer fields.
- Score display: Display the user score upon completing the test.

## Style Guidelines:

- Primary color: Dark teal (#2A9D8F) for a focused, trustworthy learning environment.
- Background color: Very light teal (#E9F5F4) for a calm, uncluttered workspace.
- Accent color: Orange (#E76F51) for calls to action and important notifications.
- Body and headline font: 'Inter' (sans-serif) for clear, readable text.
- Use simple, clean icons to represent document types and question formats.
- Clean and intuitive layout with clear separation between document upload, test settings, and test interface.
- Subtle animations for feedback and transitions, like highlighting correct/incorrect answers or fading between questions.

## Product Direction

StudyBuddy AI should be developed as one reliable vertical slice before expanding into advanced features:

```text
Sign in
  → Upload a PDF
  → Extract and normalize text
  → Ask one question about the document
  → Generate one test
  → Submit answers
  → Save and display results
```

The application should have clear boundaries between the UI, application use cases, domain services, and infrastructure. UI components manage presentation and interaction only; they should not directly know about SQL, authentication internals, AI providers, document chunking, or persistence formats.

## Target Architecture

### UI Layer

- Manage input, display, loading, error, and navigation state.
- Call typed server-side application operations.
- Keep document state, study-session state, and test state separate.
- Display explicit processing, ready, failed, and completed states.

### Application Layer

Expose focused server-side use cases:

- `createDocument`
- `getDocument`
- `askDocumentQuestion`
- `createTest`
- `submitAnswer`
- `saveStudySession`
- `getStudySession`
- `generateSummary`

Each use case should authenticate the user, validate input, load authorized data, invoke the required service, persist the result, and return a typed response.

### Domain Services

- **Document service:** validate uploads, extract text, normalize content, and create document records.
- **Retrieval service:** chunk documents, index chunks, and retrieve relevant context.
- **AI service:** answer questions, generate tests, evaluate answers, and generate summaries.
- **Study-session service:** create sessions, save progress, and complete sessions.

The AI service should expose application concepts rather than provider-specific functions. Replacing the AI provider should require changing one adapter, not UI components and business flows.

### Infrastructure Layer

Keep external systems behind adapters:

- Postgres document and session repositories.
- Clerk authentication provider.
- One supported AI provider.
- File or object storage provider when persistent original files are required.

Use one clear communication pattern between the client and server: typed server actions or standard Next.js API routes. Avoid mixing direct client imports of server-only AI code, catch-all routes, and multiple unstructured access patterns.

## Core Workflows

### Document Upload

```text
Select file
  → Client performs basic validation
  → Server validates authentication, type, and size
  → Extract text
  → Create document with status = processing
  → Chunk and index content
  → Set status = ready
```

Document lifecycle states:

- `uploaded`
- `processing`
- `ready`
- `failed`
- `deleted`

Extraction, indexing, and AI preparation should be separate operations. The UI must not assume that all of them succeed synchronously.

### Question Answering

```text
User question
  → Authenticate and verify document ownership
  → Retrieve relevant chunks
  → Send only relevant context to the AI
  → Validate the AI response
  → Return a typed answer
```

### Test Generation

```text
Test settings
  → Validate settings
  → Retrieve document context
  → Generate structured questions
  → Validate the generated schema
  → Persist the test session
  → Display questions
```

### Answer Submission

```text
Session and question
  → Verify session ownership
  → Evaluate the answer
  → Persist score and feedback
  → Return the result
```

## Initial Data Model

The major entities and relationships should be explicit:

```text
documents
  id, user_id, filename, mime_type, size, status,
  extracted_text, created_at, updated_at

document_chunks
  id, document_id, chunk_index, content, search_vector

study_sessions
  id, user_id, document_id, settings, status,
  current_question_index, created_at, updated_at

questions
  id, session_id, position, type, prompt, choices,
  correct_answer, explanation

answers
  id, session_id, question_id, answer, score, feedback, created_at

summaries
  id, user_id, document_id, content, created_at
```

Flexible AI data may use JSON, but core entities should not be hidden inside one generic progress payload.

## Scope and Priorities

The first stable version should include:

1. Authentication.
2. One supported AI provider.
3. One document type initially, preferably PDF.
4. Document extraction and indexing.
5. Document question answering.
6. Test generation.
7. Answer evaluation.
8. Basic saved progress.

The following should remain secondary until the core flow is reliable:

- Multiple AI providers.
- Cross-document question generation.
- Background question preloading.
- Advanced topic analysis.
- Complex OCR fallback.
- Provider-specific streaming.
- Elaborate session restoration.
- Generic catch-all API routing.
- Experimental or unused infrastructure integrations.

## Recovery Plan

### Phase 1: Establish One Working Path

- Choose and document one AI provider.
- Choose and document one initial document type.
- Isolate experimental flows.
- Make type checking and production builds pass.
- Report missing environment variables clearly.

### Phase 2: Separate Boundaries

- Move database access out of UI-oriented storage modules.
- Add typed server-side use cases.
- Prevent client components from importing server-only modules.
- Validate persisted session data with schemas instead of broad `unknown` values.

### Phase 3: Stabilize Document Processing

- Make extraction a dedicated service.
- Persist processing status.
- Index only after successful extraction.
- Make indexing idempotent by replacing old chunks safely.

### Phase 4: Stabilize AI

- Create one provider interface.
- Validate every AI response with schemas.
- Add explicit timeout and retry rules.
- Return structured application errors instead of silently returning empty values.

### Phase 5: Rebuild the UI Around Use Cases

- Break the large application view into focused screens or a small state machine.
- Separate document, session, and test state.
- Make loading, failed, ready, and completed states visible to the user.

## Design Principle

Do not fix every error independently while the boundaries remain unclear. First make the sign-in → upload → question → test → answer → result path reliable. Then add features behind the same stable service boundaries.

## Open Design Decisions

### Grading authorization

Keep the authenticated-user check in answer grading for now, even though the test was created by an authenticated user. This is intentional defense in depth while the session model is still being stabilized:

- Test creation proves ownership at one point in time.
- A later grading request is a separate server request and must not trust the client to preserve the original session relationship.
- The current implementation still uses document IDs directly, rather than a fully server-owned `study_session` and `question` relationship.

Once test sessions and questions are persisted as first-class records, grading should authorize the session and question relationship instead of accepting document IDs directly. This should be measured before removal; do not remove the current check based only on the assumption that creation-time authentication is sufficient.

### Adaptive client/server parsing

Do not use a single fixed file-size threshold as the only parsing decision. Device capability varies substantially between users and can affect PDF rendering, OCR, DOCX/PPTX parsing, memory pressure, and battery usage.

Use a conservative, measurable capability profile:

```text
device profile
  ├─ navigator.hardwareConcurrency
  ├─ navigator.deviceMemory when available
  ├─ browser/platform information
  ├─ file size
  ├─ PDF page count when cheaply available
  └─ recent parsing time, failures, and memory-pressure signals
```

The profile should select an initial parsing mode, not claim to know the exact device performance:

- Small text extraction may run client-side.
- OCR and large documents should begin conservatively.
- A short, cancellable capability probe may be used only if it does not noticeably delay upload.
- Parsing should have a time budget and an abort path.
- If the client parser exceeds its budget, fails, or approaches a memory-risk limit, upload should continue through the server path.
- Store performance observations locally for that device/session and adapt future decisions.

The browser APIs are incomplete and sometimes unavailable or intentionally reduced, especially on mobile browsers. Therefore, use capability signals together with the actual file workload and observed parse performance. Never rely on the device model name alone, and never assume that `hardwareConcurrency` or `deviceMemory` is exact.

The initial implementation should use a conservative fallback profile when signals are missing:

```text
unknown capability
  → client-side plain-text extraction only for small files
  → server-side parsing for OCR or larger/complex files
```

The long-term parser decision is:

```text
inspect workload + capability signals
  → choose client or server
  → enforce a time/memory budget
  → record outcome
  → adapt the next decision
```

### Initial implementation status

- New documents now receive UUIDs shared by persistence and UI state.
- Client parsing records recent duration and success/failure observations in local storage.
- The client chooses a conservative parsing recommendation from workload, available device signals, and recent observations.
- Large or complex files can now be handed to the authenticated `POST /api/documents/parse` server endpoint.
- The server parser supports PDF, DOCX, PPTX, and text files, formats PDF/DOCX/PPTX immediately, assigns UUIDs, persists the document, and returns the saved record.
- Client parsing remains available as a fallback for temporary server failures and for client-only image OCR.
- Document writes now move through `processing` → `ready`, record `failed` state on indexing errors, and replace stale RAG chunks on re-index.
- The remaining items below are active implementation work, not completed features; the parser handoff is the completed slice.

### Next implementation sequence

1. **Make document persistence authoritative**
   - Return persistence and indexing failures to the upload operation instead of only logging them.
   - Add an explicit document processing status (`processing`, `ready`, `failed`) and display it in the UI.
   - Replace stale RAG chunks safely when a document is re-uploaded or updated.
   - Keep the original upload only if later requirements need faithful reprocessing, download, or auditability; otherwise structured canonical content is the primary stored representation.

2. **Make canonical structured content the context boundary**
   - Define one canonical document content field or explicit source-of-truth rule.
   - Keep extracted text only as a temporary parsing value or migration field, not as a second competing context source.
   - Make formatting failures visible instead of silently treating unformatted extraction as successful formatting.

3. **Make RAG the central provider**
   - Route Q&A, test generation, grading, summaries, and explanations through one retrieval service.
   - Pass document/session identifiers and retrieval options to the server, never client-selected full text.
   - Prefer relevant indexed chunks; restrict random fallback to controlled exploratory generation.

   **Implemented in the current slice:** Q&A, batch test generation, cross-document
   generation, answer validation, explanations, and summaries now resolve context
   from authenticated document IDs through the RAG index. Client-provided document
   text remains only as a legacy input shape at some UI boundaries and is ignored
   when the server builds AI context.

### AI response format policy

Use the smallest reliable format for each operation:

- Q&A and explanations: plain text or Markdown.
- Summaries and document formatting: streamed Markdown.
- Grading: compact `SCORE<TAB>number` and `FEEDBACK<TAB>text` records.
- Test questions: one tab-delimited record per question, with choices separated
  by ` || `.
- Topic extraction and other deeply nested metadata: validated JSON remains
  acceptable.

The server converts every AI response into typed application results before
returning it to the UI. Compact formats are not accepted without validation;
malformed records fail explicitly rather than being treated as successful AI
output.

4. **Replace generic test progress with study sessions**
   - Add first-class study-session, question, and answer records.
   - Authorize grading through the persisted session/question relationship.
   - Remove direct document-ID grading checks only after the session path is measured and stable.

   **Implemented in the current slice:** study sessions now store the authorized
   document set and settings; generated questions are persisted as session
   questions; grading verifies the signed-in user owns the session and records
   answers against the session question. The legacy `test_progress` table remains
   for device restoration until migration and cleanup are complete.

   Session progress is now also stored on the server, generated questions are
   synchronized as they arrive, and completed tests mark their study session
   completed.       Server-side restore now loads active study-session progress and carries the
   original session ID back into the test view. Starting fresh explicitly
   abandons the active session, and new sessions no longer write legacy
   `test_progress` data.

5. **Add long-running upload UX**
   - Add cancellation and progress reporting for large server parses.
   - Introduce a job/status flow if parsing and indexing exceed the request duration.
   - Keep image OCR client-side initially, then add a separate server OCR path if product requirements justify it.

   The upload UI now exposes cancellation for the server parsing request and
   preserves client-side progress where available. The server parser remains a
   bounded synchronous request; a job/status flow is only needed if production
   measurements show uploads exceeding the request duration.