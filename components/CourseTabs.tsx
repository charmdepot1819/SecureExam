import Link from "next/link";

export default function CourseTabs({ course, active, teacher }: { course: any; active: string; teacher: boolean }) {
  const tabs = teacher
    ? [["", "Assessments"], ["people", "People"], ["bank", "Question bank"], ["gradebook", "Gradebook"]]
    : [["", "Assessments"], ["gradebook", "My grades"]];
  return (
    <>
      <div className="muted" style={{ fontSize: "0.85rem" }}>{course.code}</div>
      <h1>{course.title}</h1>
      <nav className="tabs">
        {tabs.map(([href, label]) => (
          <Link key={href} href={`/courses/${course.id}${href ? "/" + href : ""}`} className={active === href ? "on" : ""}>{label}</Link>
        ))}
      </nav>
    </>
  );
}
