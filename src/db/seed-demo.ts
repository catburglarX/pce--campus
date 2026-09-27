/**
 * Optional demo content, run with: bun run seed:demo
 *
 * This exists so a fresh install has something to look at. It writes rows directly rather than going
 * through the services, because a seeder needs to place ratings on specific past dates rather than
 * obey the rating window a live student is held to.
 *
 * Every demo account shares one password, which is printed when the seeder runs. That is acceptable for
 * sample data on a laptop and unacceptable for anything real, so the README says to delete the database
 * before the site is used by actual students.
 */

import type { SQLQueryBindings } from "bun:sqlite";

import { getDb, useDatabase } from "./connection";
import { config } from "../config";
import { collegeDate, isoTimestamp, shiftDate } from "../domain/calendar";
import { MEALS } from "../domain/rating";
import { hashPassword } from "../services/users";
import { seedBaseData } from "./seed";

export const DEMO_PASSWORD = "campus-demo-not-for-real-use";

type DemoStudent = { email: string; name: string; branch: string; year: number; hostel: boolean };

const STUDENTS: DemoStudent[] = [
  { email: "aarti.gupta@poornima.org", name: "Aarti Gupta", branch: "Computer Science", year: 3, hostel: true },
  { email: "rahul.sharma@poornima.org", name: "Rahul Sharma", branch: "Mechanical", year: 2, hostel: true },
  { email: "sneha.agarwal@poornima.org", name: "Sneha Agarwal", branch: "Electronics", year: 4, hostel: false },
  { email: "vikas.jain@poornima.org", name: "Vikas Jain", branch: "Civil", year: 1, hostel: true },
  { email: "priya.meena@poornima.org", name: "Priya Meena", branch: "Computer Science", year: 2, hostel: true },
  { email: "deepak.yadav@poornima.org", name: "Deepak Yadav", branch: "Information Technology", year: 3, hostel: false },
];

type DemoReview = {
  author: number;
  category: string;
  subject: string;
  title: string;
  body: string;
  stars: number;
  anonymous?: boolean;
};

const REVIEWS: DemoReview[] = [
  {
    author: 0, category: "mess-food", subject: "Dinner, weekdays",
    title: "Dal is watery on most weekday nights",
    body: "The dinner dal has been thin all month. Lunch is fine, and Sunday dinner is genuinely good, so it looks like a staffing problem at night rather than the recipe.",
    stars: 2,
  },
  {
    author: 1, category: "mess-food", subject: "Sunday special",
    title: "Sunday biryani is the best meal of the week",
    body: "Portion size is generous and the raita is fresh. If the rest of the week matched Sunday nobody would complain about the mess at all.",
    stars: 5,
  },
  {
    author: 2, category: "hostel", subject: "Block C, third floor",
    title: "Water stops after 9 pm almost every night",
    body: "Taps run dry by about 9 and come back around 6 in the morning. Reported to the warden twice. Fine in blocks A and B, so it seems to be the block C tank.",
    stars: 2,
  },
  {
    author: 3, category: "wifi", subject: "Hostel WiFi",
    title: "WiFi drops every evening between 8 and 10",
    body: "Exactly when everyone starts studying, the connection drops to nothing. Works fine in the academic block during the day.",
    stars: 1, anonymous: true,
  },
  {
    author: 4, category: "library", subject: "Reading room, first floor",
    title: "Reading room is quiet in the morning and loud after 4",
    body: "Mornings are perfect. After four it becomes a group study room and nobody enforces the silence rule. Ask for a separate discussion room.",
    stars: 3,
  },
  {
    author: 5, category: "faculty", subject: "Data structures",
    title: "Doubt sessions actually happen and they help",
    body: "The extra Friday doubt session before the mid term made a real difference. Notes are shared before class, which is rare.",
    stars: 5,
  },
  {
    author: 0, category: "transport", subject: "Bus route 4",
    title: "Route 4 leaves early about twice a week",
    body: "Timetable says 7:40 and it has left at 7:35 more than once. Missing it means a 200 rupee auto. A minute of waiting would fix this.",
    stars: 2,
  },
  {
    author: 1, category: "classrooms", subject: "Room 301 projector",
    title: "Projector bulb in 301 has been dim for weeks",
    body: "Anything with fine diagrams is unreadable from the back rows. Room 302 is fine, so classes get shifted when someone remembers.",
    stars: 2,
  },
  {
    author: 2, category: "canteen", subject: "Evening counter",
    title: "Canteen prices went up but the samosa got smaller",
    body: "Ten rupees more this term and visibly less filling. Tea is still good and the staff are quick during the break rush.",
    stars: 3,
  },
  {
    author: 3, category: "sports", subject: "Gym",
    title: "Gym equipment is good, the timing is the problem",
    body: "Weights and machines are in decent condition. Opening only from 6 to 8 in the evening means it is packed the whole time.",
    stars: 4,
  },
  {
    author: 4, category: "placement", subject: "Training sessions",
    title: "Aptitude training is useful, communication rounds are not",
    body: "The aptitude classes are well run. The group discussion practice is forty students in one room, so nobody gets to speak twice.",
    stars: 3,
  },
  {
    author: 5, category: "washrooms", subject: "Academic block B",
    title: "Second floor washroom is cleaned once and then forgotten",
    body: "Morning cleaning is done properly. By afternoon there is no water in the taps. The ground floor one is maintained much better.",
    stars: 2, anonymous: true,
  },
];

type DemoComplaint = {
  author: number;
  category: string;
  title: string;
  body: string;
  location: string;
  severity: string;
  status: string;
  note: string;
};

const COMPLAINTS: DemoComplaint[] = [
  {
    author: 2, category: "hostel", title: "No water in block C after 9 pm",
    body: "Third floor taps are dry every night this week. Students are carrying buckets from the ground floor.",
    location: "Hostel block C, third floor", severity: "high", status: "in_progress",
    note: "Maintenance checked the tank on 20 September, pump replacement requested.",
  },
  {
    author: 3, category: "wifi", title: "Hostel WiFi unusable between 8 and 10 pm",
    body: "Connection drops completely during study hours. Speed test fails to load at all.",
    location: "Hostel block A common room", severity: "normal", status: "open", note: "",
  },
  {
    author: 1, category: "classrooms", title: "Projector in room 301 is too dim to read",
    body: "Diagrams cannot be seen past the fourth row. Bulb looks like it is at the end of its life.",
    location: "Academic block A, room 301", severity: "normal", status: "resolved",
    note: "New bulb fitted on 19 September. Please report again if it dims.",
  },
  {
    author: 0, category: "mess-food", title: "Dinner dal watery for the third week",
    body: "Consistently thin at dinner. Lunch is fine, so it is not the recipe.",
    location: "Main mess", severity: "normal", status: "open", note: "",
  },
  {
    author: 5, category: "washrooms", title: "No water in block B second floor washroom",
    body: "Taps dry from the afternoon onwards, every day this week.",
    location: "Academic block B, second floor", severity: "high", status: "open", note: "",
  },
  {
    author: 4, category: "transport", title: "Route 4 bus leaves before the scheduled time",
    body: "Left at 7:35 instead of 7:40 on Monday and Wednesday.",
    location: "Main gate stop", severity: "low", status: "rejected",
    note: "Driver log shows departure at 7:41 both days. Raising again with GPS timestamps would help.",
  },
];

const NOTICES = [
  {
    title: "Mess committee meeting this Friday, 4 pm, room 204",
    body: "Bring specific complaints with dates. The dinner dal and the Sunday menu are on the agenda. Two student representatives per hostel block.",
    pinned: true,
  },
  {
    title: "Hostel water tank cleaning on Saturday morning",
    body: "Supply to blocks B and C will be off between 7 and 11 am on Saturday. Store water on Friday night.",
    pinned: false,
  },
  {
    title: "This site is private to Poornima College of Engineering students",
    body: "Do not share the join code outside your class groups. Reviews may be anonymous to other students, but abuse can still be traced by an admin.",
    pinned: false,
  },
];

function categoryIdBySlug(slug: string): number {
  const row = getDb().query<{ id: number }, [string]>("SELECT id FROM categories WHERE slug = ?").get(slug);
  if (!row) throw new Error(`Demo seed needs category "${slug}", which is not seeded`);
  return row.id;
}

async function insertStudents(): Promise<number[]> {
  const db = getDb();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = isoTimestamp();
  const ids: number[] = [];
  for (const student of STUDENTS) {
    db.run(
      `INSERT INTO users (email, name, password_hash, branch, study_year, is_hostel_resident, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      [student.email, student.name, passwordHash, student.branch, student.year, student.hostel ? 1 : 0, now, now],
    );
    const row = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE email = ?").get(student.email);
    if (!row) throw new Error(`Demo student ${student.email} could not be read back`);
    ids.push(row.id);
  }
  return ids;
}

function insertMessRatings(studentIds: number[]): number {
  const db = getDb();
  const today = collegeDate();
  const comments = [
    "Dal was watery again.",
    "Roti was hot and fresh today.",
    "Rice was undercooked.",
    "Good quantity, tasted fine.",
    "Sabzi had too much oil.",
    "",
  ];
  const insert = db.query(
    `INSERT INTO mess_ratings (user_id, served_on, meal, stars, taste, hygiene, quantity, comment, is_anonymous, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, served_on, meal) DO NOTHING`,
  );
  let written = 0;
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const servedOn = shiftDate(today, -dayOffset);
    const stamp = `${servedOn}T13:00:00.000Z`;
    studentIds.forEach((userId, index) => {
      MEALS.forEach((meal, mealIndex) => {
        if ((index + mealIndex + dayOffset) % 3 === 0) return;
        const base = 2 + ((index + mealIndex + dayOffset) % 4);
        const stars = Math.min(5, Math.max(1, base));
        insert.run(
          userId, servedOn, meal, stars, stars, Math.min(5, stars + 1), Math.max(1, stars - 1),
          comments[(index + dayOffset) % comments.length] as string,
          index === 3 ? 1 : 0, stamp, stamp,
        );
        written += 1;
      });
    });
  }
  return written;
}

function insertReviews(studentIds: number[]): number[] {
  const db = getDb();
  const ids: number[] = [];
  REVIEWS.forEach((review, index) => {
    const stamp = `${shiftDate(collegeDate(), -(index % 6))}T09:${String(10 + index).padStart(2, "0")}:00.000Z`;
    const created = db
      .query<{ id: number }, [number, number, string, string, string, number, number, string, string]>(
        `INSERT INTO reviews (user_id, category_id, subject, title, body, stars, is_anonymous, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        studentIds[review.author] as number,
        categoryIdBySlug(review.category),
        review.subject,
        review.title,
        review.body,
        review.stars,
        review.anonymous ? 1 : 0,
        stamp,
        stamp,
      );
    if (created) ids.push(created.id);
  });
  return ids;
}

function insertEngagement(studentIds: number[], reviewIds: number[]): void {
  const db = getDb();
  const now = isoTimestamp();
  const vote = db.query(
    "INSERT INTO review_votes (review_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
  );
  reviewIds.forEach((reviewId, index) => {
    studentIds.forEach((userId, studentIndex) => {
      if ((index + studentIndex) % 3 !== 0) return;
      const author = studentIds[REVIEWS[index]?.author ?? 0];
      if (userId === author) return;
      vote.run(reviewId, userId, now);
    });
  });

  const comment = db.query(
    "INSERT INTO review_comments (review_id, user_id, body, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const replies = [
    "Same in my block, it started around the middle of the month.",
    "Reported this at the office last week, no reply yet.",
    "Not my experience, mine has been fine so far.",
  ];
  reviewIds.slice(0, 3).forEach((reviewId, index) => {
    comment.run(reviewId, studentIds[(index + 2) % studentIds.length] as number, replies[index] as string, 0, now);
  });
}

function insertComplaints(studentIds: number[], adminId: number): number {
  const db = getDb();
  const support = db.query(
    "INSERT INTO complaint_votes (complaint_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
  );
  let written = 0;
  COMPLAINTS.forEach((complaint, index) => {
    const stamp = `${shiftDate(collegeDate(), -(index % 5))}T11:${String(20 + index).padStart(2, "0")}:00.000Z`;
    const closing = complaint.status === "resolved" || complaint.status === "rejected";
    const created = db
      .query<{ id: number }, SQLQueryBindings[]>(
        `INSERT INTO complaints (user_id, category_id, title, body, location, severity, status, resolution_note,
                                 resolved_by, is_anonymous, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        studentIds[complaint.author] as number,
        categoryIdBySlug(complaint.category),
        complaint.title,
        complaint.body,
        complaint.location,
        complaint.severity,
        complaint.status,
        complaint.note,
        closing ? adminId : null,
        0,
        stamp,
        stamp,
      );
    if (!created) return;
    written += 1;
    studentIds.forEach((userId, studentIndex) => {
      if (userId === studentIds[complaint.author]) return;
      if ((index + studentIndex) % 2 === 0) support.run(created.id, userId, stamp);
    });
  });
  return written;
}

function insertNotices(adminId: number): number {
  const db = getDb();
  const insert = db.query(
    "INSERT INTO notices (author_id, title, body, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const existing = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM notices").get();
  if ((existing?.total ?? 0) > 0) return 0;
  NOTICES.forEach((notice, index) => {
    const stamp = `${shiftDate(collegeDate(), -index)}T08:00:00.000Z`;
    insert.run(adminId, notice.title, notice.body, notice.pinned ? 1 : 0, stamp, stamp);
  });
  return NOTICES.length;
}

export async function seedDemoContent(): Promise<void> {
  const db = getDb();
  const alreadySeeded = db.query<{ total: number }, []>("SELECT COUNT(*) AS total FROM reviews").get();
  if ((alreadySeeded?.total ?? 0) > 0) {
    console.log("Demo content already present, nothing written.");
    return;
  }
  const admin = db.query<{ id: number }, []>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error("Run the base seed first so an admin exists");

  const studentIds = await insertStudents();
  const mealRatings = insertMessRatings(studentIds);
  const reviewIds = insertReviews(studentIds);
  insertEngagement(studentIds, reviewIds);
  const complaints = insertComplaints(studentIds, admin.id);
  const notices = insertNotices(admin.id);

  console.log(`Demo data written to ${config.databasePath}`);
  console.log(`  ${studentIds.length} students, ${reviewIds.length} reviews, ${mealRatings} meal ratings`);
  console.log(`  ${complaints} complaints, ${notices} notices`);
  console.log(`  Every demo student signs in with: ${DEMO_PASSWORD}`);
  console.log("  Example: aarti.gupta@poornima.org");
}

if (import.meta.main) {
  useDatabase(config.databasePath);
  await seedBaseData();
  await seedDemoContent();
}
