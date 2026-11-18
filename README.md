# Exam Online

A browser-based LMS for creating, delivering and grading quizzes, exams and file-upload assignments. It works on phones first, and on tablets and computers too.

- **Educator mode.** Educators create courses, tag other users as students, build assessments and grade them. One click switches an educator to the student view.
- **Question types.** Multiple choice, multiple answers (partial credit), true/false, short answer (auto-graded), essay and file upload (both teacher-graded).
- **Question banks.** Reuse questions, and give each student a random draw of N questions from a bank.
- **Delivery.** Open, due and close dates, time limits that the server enforces, attempt limits (highest attempt counts), late submissions, shuffled questions and answer choices, and one-question-at-a-time with optional no-backtracking.
- **Grading.** Objective items grade instantly. Teachers grade essays and uploads with per-question feedback and can override any score. "Grade next" moves through the queue.
- **Gradebook** with CSV export, and **item analysis** (difficulty, discrimination, distractor use).
- **Exam integrity.** Auto-submit when a student leaves the page (another tab or app, or exiting fullscreen), with optional warnings. Also fullscreen, copy/paste/right-click/print blocking, a student-name watermark, an academic honesty statement, two-tab detection, and an integrity log with timestamps for every attempt. Optional **Safe Exam Browser** enforcement for computer labs and iPads.

## Run it locally

Requirements: **Node.js 22.13 or newer**. The database is Node's built-in SQLite, so there's nothing else to install.

```bash
npm install
npm run seed      # optional: demo course, quiz and assignment
npm run build
npm start         # http://localhost:3000
```

For development, run `npm run dev` instead of build + start.

Demo logins (after `npm run seed`, password `password123` for all):

| Role | Email |
| --- | --- |
| Educator | teacher@example.com |
| Students | student1@example.com, student2@example.com, student3@example.com |

On a fresh install without seeding, **the first account you register becomes an educator**. Later accounts are students until an educator promotes them under **Users**.

### Typical flow

1. Educator: **New course**, then **People**: tag registered users as students (tick them or paste emails).
2. **Question bank**: add questions with explanations. Or write questions directly inside an assessment.
3. Course page: **Create** a quiz, exam or assignment. Add questions or a random draw, set dates, time limit and integrity options, choose who it's assigned to, then **Publish**.
4. Students see it under **My work**, read the rules, agree to the honesty statement and start.
5. Educator: **Submissions**, then **Grade next**, then **Gradebook** and **Item analysis**.

### Using it from students' phones

Students need to reach the server. For a class trial on the same Wi-Fi, run `npm start` and have students open `http://<your-computer's-IP>:3000`. For real use, deploy behind HTTPS (any Node host or a VPS with a reverse proxy) and set:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | e.g. `https://exams.myschool.edu`. Used for Safe Exam Browser links and key checks. Set it whenever you're behind a proxy. |
| `APP_SECRET` | Secret used to sign Safe Exam Browser access cookies. A random one is generated in `data/` if unset. |
| `DATA_DIR` | Where the database and uploads live (default `./data`). Back this folder up. |

## Exam integrity: what it does and what it can't do

| Measure | Where it works | What happens |
| --- | --- | --- |
| Leave detection (tab hidden, app switch, window loses focus, fullscreen exit) | All modern browsers | Logged. Depending on the exam setting it shows a warning, or auto-submits after N warnings. The server enforces the count, so reloading doesn't reset it. |
| Fullscreen | Android Chrome, desktop browsers | Requested at start. Leaving fullscreen counts as leaving. iPhone browsers don't support page fullscreen, so on iPhones this step is skipped. |
| Copy, paste, right-click, text selection, print, common shortcuts | All browsers | Blocked and logged. Students can still type in answer boxes. |
| Watermark with the student's name and email | All | Discourages sharing photos of the screen and makes leaks traceable. |
| Shuffled questions and choices, random draws from banks | All | Each student sees a different order or set. |
| Time limit, close date | Server-side | Answers are rejected after the deadline (30 s grace for slow networks). Expired attempts are submitted automatically. |
| Exam open in two tabs | All | Logged. |
| Developer tools heuristic | Computers only | Logged only. It can produce false positives, so it never auto-submits. |
| Safe Exam Browser (optional per exam) | Windows, macOS, iPad/iPhone | The server only admits SEB running *this exam's* config (Config Key check). SEB blocks other apps, screenshots and app switching at the operating-system level. |

**Limits. Please read before relying on it for high-stakes exams:**

- A web page can't see or control anything outside itself. **No browser-based system can stop a second device** (another phone, a classmate, a smart watch) or a person helping in the room. Assessment design and in-person or video proctoring are the only answers to that.
- Leave detection can fire for innocent reasons: an incoming call, a notification tapped by accident, the screen timing out, or the phone's back gesture leaving fullscreen. The integrity log is a **signal, not proof**. Teachers can **reopen** a wrongly auto-submitted attempt with extra minutes. Consider allowing 1 warning instead of 0 for phones, and tell students to turn on Do Not Disturb.
- On Android, choosing a file for an upload question opens the system file picker, which hides the page. That event is logged as "file picker" and doesn't count as leaving. A determined student could misuse that moment, so it's visible in the log.
- Screenshots can't be blocked in a normal browser. Only an OS-level lockdown can do that (SEB on computers and iPads, or a native app).
- Safe Exam Browser has no Android version. Exams that require SEB can't be taken on Android phones.
- The `.seb` config is unencrypted, as in Moodle's integration, so a technically skilled student could compute the Config Key and spoof the header from another browser. For higher assurance, open the downloaded config in the SEB Config Tool, encrypt it or change settings, and paste the resulting Browser Exam Key or Config Key into **Extra accepted keys**.

## Evidence base for the design choices

| Feature | Rationale | Source |
| --- | --- | --- |
| Practice quizzes with multiple attempts | Retrieval practice (testing) improves long-term retention more than restudying. | Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science, 17*(3), 249–255. |
| Explanations shown with feedback; "immediate" mode for practice quizzes | Feedback is among the strongest influences on learning, especially when it explains the task rather than only saying right or wrong. | Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1), 81–112. Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research, 78*(1), 153–189. |
| "After due date" feedback for exams | Keeps the answer key private until every student has finished. This is a practical exam-security choice rather than a learning-science finding. | (Practice; see Cluskey et al. below.) |
| Randomized order, one-at-a-time with no backtracking, tight time limits, short open windows, single attempt, lockdown browser, rotating questions via banks | These are the online exam control procedures recommended for unproctored exams. | Cluskey, G. R., Ehlen, C. R., & Raiborn, M. H. (2011). Thwarting online exam cheating without proctor supervision. *Journal of Academic and Business Ethics, 4*. |
| A clear warning that the exam is monitored and penalties apply, shown before every exam | In an observational study of unproctored online exams, honesty appeals and honesty pledges *did not* reduce cheating. A warning about detection plus stated penalties did (from about 70% to about 15% of students). The pledge is therefore optional, and the monitoring warning is always shown when integrity features are on. | Pleasants, J., Pleasants, J. M., & Pleasants, B. (2022). Cheating on unproctored online exams. *Online Learning, 26*(1). |
| Item analysis: difficulty p and corrected item–total discrimination with quality bands (≥ .40 very good, .30–.39 good, .20–.29 marginal, < .20 review) | Classical test theory tools for spotting ambiguous items or wrong keys. | Ebel, R. L., & Frisbie, D. A. (1991). *Essentials of Educational Measurement* (5th ed.). Prentice Hall. |
| Multiple-answer partial credit (right − wrong) / keyed | Gives credit for partial knowledge while penalizing "select all" guessing. | Common LMS scoring practice. Choose all-or-nothing by using single-answer items if you prefer. |

Item-writing tip: well-written distractors matter more than the number of choices. Three good options are often as effective as four or five (Rodriguez, M. C. (2005). Three options are optimal for multiple-choice items. *Educational Measurement: Issues and Practice, 24*(2), 3–13). Item analysis flags distractors that nobody picks.

## Safe Exam Browser details

- Teachers tick **Require Safe Exam Browser**, then save and publish. The editor shows the start link (`sebs://…/exams/<id>/config.seb`), a `.seb` download and the Config Key.
- The config's start URL is `/exams/<id>/lockdown`. SEB for Windows sends `X-SafeExamBrowser-ConfigKeyHash`, which is checked directly. SEB for macOS and iOS (modern WebView) exposes the same value through its JavaScript API, which the page posts back for checking. On success the server sets a signed, 6-hour cookie for that user and exam, which is required to start the exam, save answers and submit.
- The Config Key implementation follows the [SEB specification](https://safeexambrowser.org/developer/seb-config-key.html). It's tested against two real SEB config files with known keys (from Moodle's test suite) in `tests/seb-config-key.test.ts`. Run it with `npm test`.

## Project layout

```
app/                 Next.js App Router pages, server actions (app/actions.ts) and API routes
components/          UI pieces; ExamRunner.tsx is the exam-taking client with integrity monitoring
lib/db.ts            SQLite schema and helpers (node:sqlite)
lib/exam.ts          Attempt building, randomization, auto-grading, deadlines
lib/seb.ts           SEB config generation and Config Key algorithm
lib/seb-access.ts    SEB request verification and signed access cookies
lib/analysis.ts      Item analysis
scripts/seed.ts      Demo data
tests/               Unit tests (npm test)
data/                Database and uploaded files (created at first run, git-ignored)
```

## Notes

- Uploaded files are stored in `data/uploads` and are only downloadable by the student who uploaded them and the course's teachers.
- Passwords are hashed with scrypt. Sessions are HTTP-only cookies.
- `node:sqlite` prints an "experimental" warning on Node 22. It's stable for this use and the warning is harmless.
