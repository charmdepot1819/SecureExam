// Creates demo data: 1 educator, 3 students, a course with a question bank, a published quiz and a file assignment.
// Usage: npm run seed   (does nothing if the demo teacher already exists)
import crypto from "node:crypto";
import { get, run } from "../lib/db.ts";

function hash(pw: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

if (get("SELECT 1 FROM users WHERE email = 'teacher@example.com'")) {
  console.log("Demo data already exists.");
  process.exit(0);
}
const PW = "password123";
const teacher = run("INSERT INTO users (name, email, password_hash, is_educator) VALUES (?, ?, ?, 1)", "Demo Teacher", "teacher@example.com", hash(PW)).id;
const students = ["Ana Santos", "Ben Cruz", "Carla Reyes"].map(
  (n, i) => run("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", n, `student${i + 1}@example.com`, hash(PW)).id
);
const course = run("INSERT INTO courses (title, code, description, owner_id) VALUES (?, ?, ?, ?)", "Biology 101", "BIO101", "Introductory biology.", teacher).id;
run("INSERT INTO enrollments (course_id, user_id, role) VALUES (?, ?, 'teacher')", course, teacher);
for (const s of students) run("INSERT INTO enrollments (course_id, user_id, role) VALUES (?, ?, 'student')", course, s);
const bank = run("INSERT INTO banks (course_id, title) VALUES (?, ?)", course, "Cells").id;

const q = (type: string, prompt: string, options: any[], answer: any, points = 1, feedback = "") =>
  run(
    "INSERT INTO questions (course_id, bank_id, type, prompt, options_json, answer_json, points, feedback) VALUES (?,?,?,?,?,?,?,?)",
    course, bank, type, prompt, JSON.stringify(options), JSON.stringify(answer), points, feedback
  ).id;
const o = (...t: string[]) => t.map((text, i) => ({ id: `o${i}`, text }));

const ids = [
  q("mc", "Which organelle produces most of a cell's ATP?", o("Mitochondrion", "Ribosome", "Golgi apparatus", "Lysosome"), { correct: "o0" }, 1, "Oxidative phosphorylation in the mitochondria produces most ATP."),
  q("mc", "Which structure is found in plant cells but not animal cells?", o("Cell wall", "Nucleus", "Cell membrane", "Ribosome"), { correct: "o0" }, 1, "Plant cells have a cellulose cell wall."),
  q("tf", "Prokaryotic cells have a membrane-bound nucleus.", [{ id: "true", text: "True" }, { id: "false", text: "False" }], { correct: "false" }, 1, "Prokaryotes lack a nucleus; their DNA sits in the nucleoid."),
  q("multi", "Select ALL organelles that contain their own DNA.", o("Mitochondria", "Chloroplasts", "Golgi apparatus", "Endoplasmic reticulum"), { correct: ["o0", "o1"] }, 2, "Endosymbiotic theory: mitochondria and chloroplasts keep their own genomes."),
  q("short", "Name the process by which a cell divides into two identical daughter cells.", [], { accepted: ["mitosis"] }, 1, "Mitosis yields two genetically identical cells."),
  q("essay", "Explain in 3–5 sentences why cells are small. Use the idea of surface area to volume ratio.", [], {}, 4),
];
const exam = run(
  `INSERT INTO exams (course_id, title, instructions, kind, time_limit_min, due_at, max_attempts, feedback_mode, published, focus_policy, focus_warnings)
   VALUES (?, ?, ?, 'quiz', 15, ?, 2, 'immediate', 1, 'submit', 1)`,
  course,
  "Quiz 1: Cells",
  "Answer every question. You have 15 minutes.",
  new Date(Date.now() + 7 * 864e5).toISOString()
).id;
ids.forEach((qid, i) => run("INSERT INTO exam_items (exam_id, position, question_id) VALUES (?, ?, ?)", exam, i + 1, qid));

const asg = run(
  `INSERT INTO exams (course_id, title, instructions, kind, due_at, max_attempts, feedback_mode, published, focus_policy, require_fullscreen, block_copy, require_pledge, shuffle_questions)
   VALUES (?, ?, ?, 'assignment', ?, 1, 'immediate', 1, 'off', 0, 0, 1, 0)`,
  course,
  "Lab report: Onion cells",
  "Upload your lab report as a PDF or Word file.",
  new Date(Date.now() + 14 * 864e5).toISOString()
).id;
const up = run(
  "INSERT INTO questions (course_id, bank_id, type, prompt, options_json, answer_json, points) VALUES (?, NULL, 'file', ?, '[]', ?, 20)",
  course,
  "Upload your lab report.",
  JSON.stringify({ accept: ".pdf,.docx,.doc,.jpg,.png", maxMb: 20 })
).id;
run("INSERT INTO exam_items (exam_id, position, question_id) VALUES (?, 1, ?)", asg, up);

console.log(`Demo data created. Sign in as teacher@example.com or student1@example.com (password: ${PW}).`);
