// Creates demo data in Firebase: 1 educator, 3 students, a course with a question bank, a published quiz and a file assignment.
// Usage:
//   Emulators:  npm run seed:emulator   (with `npm run emulators` running)
//   Real project: FIREBASE_SERVICE_ACCOUNT='<json>' npm run seed
// Does nothing if the demo teacher already exists.
import { adminAuth, fdb } from "../lib/db.ts";

const PW = "password123";
const now = () => new Date().toISOString();

async function user(email: string, name: string, educator: boolean) {
  const u = await adminAuth().createUser({ email, password: PW, displayName: name });
  await fdb().collection("users").doc(u.uid).set({ name, email, is_educator: educator ? 1 : 0, created_at: now() });
  return u.uid;
}

async function main() {
  try {
    await adminAuth().getUserByEmail("teacher@example.com");
    console.log("Demo data already exists.");
    return;
  } catch {}
  const db = fdb();
  const teacher = await user("teacher@example.com", "Demo Teacher", true);
  const students = [
    await user("student1@example.com", "Ana Santos", false),
    await user("student2@example.com", "Ben Cruz", false),
    await user("student3@example.com", "Carla Reyes", false),
  ];
  await db.collection("meta").doc("app").set({ has_users: true }, { merge: true });

  const course = db.collection("courses").doc();
  await course.set({ title: "Biology 101", code: "BIO101", description: "Introductory biology.", owner_id: teacher, created_at: now() });
  await db.collection("enrollments").doc(`${course.id}_${teacher}`).set({ course_id: course.id, user_id: teacher, role: "teacher" });
  for (const s of students) await db.collection("enrollments").doc(`${course.id}_${s}`).set({ course_id: course.id, user_id: s, role: "student" });
  const bank = db.collection("banks").doc();
  await bank.set({ course_id: course.id, title: "Cells" });

  const o = (...t: string[]) => t.map((text, i) => ({ id: `o${i}`, text }));
  const q = async (type: string, prompt: string, options: any[], answer: any, points = 1, feedback = "", bankId: string | null = bank.id) => {
    const r = db.collection("questions").doc();
    await r.set({ course_id: course.id, bank_id: bankId, type, prompt, options, answer, points, feedback, created_at: now() });
    return r.id;
  };
  const ids = [
    await q("mc", "Which organelle produces most of a cell's ATP?", o("Mitochondrion", "Ribosome", "Golgi apparatus", "Lysosome"), { correct: "o0" }, 1, "Oxidative phosphorylation in the mitochondria produces most ATP."),
    await q("mc", "Which structure is found in plant cells but not animal cells?", o("Cell wall", "Nucleus", "Cell membrane", "Ribosome"), { correct: "o0" }, 1, "Plant cells have a cellulose cell wall."),
    await q("tf", "Prokaryotic cells have a membrane-bound nucleus.", [{ id: "true", text: "True" }, { id: "false", text: "False" }], { correct: "false" }, 1, "Prokaryotes lack a nucleus; their DNA sits in the nucleoid."),
    await q("multi", "Select ALL organelles that contain their own DNA.", o("Mitochondria", "Chloroplasts", "Golgi apparatus", "Endoplasmic reticulum"), { correct: ["o0", "o1"] }, 2, "Endosymbiotic theory: mitochondria and chloroplasts keep their own genomes."),
    await q("short", "Name the process by which a cell divides into two identical daughter cells.", [], { accepted: ["mitosis"] }, 1, "Mitosis yields two genetically identical cells."),
    await q("essay", "Explain in 3–5 sentences why cells are small. Use the idea of surface area to volume ratio.", [], {}, 4),
  ];
  const base = {
    instructions: "", kind: "quiz", time_limit_min: null, available_from: null, due_at: null, lock_at: null, allow_late: 0, max_attempts: 1,
    shuffle_questions: 1, shuffle_options: 1, feedback_mode: "after_due", show_correct: 1, focus_policy: "submit", focus_warnings: 0,
    require_fullscreen: 1, block_copy: 1, one_at_a_time: 0, lock_backtrack: 0, require_pledge: 1, require_lockdown: 0,
    seb_quit_hash: "", seb_extra_keys: "", published: 1, assign_all: 1, course_id: course.id, created_at: now(),
  };
  const quiz = db.collection("exams").doc();
  await quiz.set({
    ...base, title: "Quiz 1: Cells", instructions: "Answer every question. You have 15 minutes.", time_limit_min: 15,
    due_at: new Date(Date.now() + 7 * 864e5).toISOString(), max_attempts: 2, feedback_mode: "immediate", focus_warnings: 1,
  });
  for (const [i, qid] of ids.entries()) await db.collection("exam_items").add({ exam_id: quiz.id, position: i + 1, question_id: qid, bank_id: null, draw_count: null });

  const lab = db.collection("exams").doc();
  await lab.set({
    ...base, title: "Lab report: Onion cells", kind: "assignment", instructions: "Upload your lab report as a PDF or Word file.",
    due_at: new Date(Date.now() + 14 * 864e5).toISOString(), feedback_mode: "immediate", focus_policy: "off", require_fullscreen: 0, block_copy: 0, shuffle_questions: 0,
  });
  const up = await q("file", "Upload your lab report.", [], { accept: ".pdf,.docx,.doc,.jpg,.png", maxMb: 2 }, 20, "", null);
  await db.collection("exam_items").add({ exam_id: lab.id, position: 1, question_id: up, bank_id: null, draw_count: null });

  console.log(`Demo data created. Sign in as teacher@example.com or student1@example.com (password: ${PW}).`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
