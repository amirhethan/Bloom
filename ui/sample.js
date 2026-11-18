// Sample content for the approved concept board. Static for milestone 1;
// milestone 2 replaces this with SQLite-backed state.

export const project = {
  id: "p_3hour",
  name: "The 3-Hour Rule",
  status: "Outlined",
  wordsPerMinute: 150,
};

export const viewport = { x: 0, y: 0, zoom: 1 };

export const frame = { id: "f_open", label: "Opening", x: 52, y: 116, w: 356, h: 380 };

export const cards = [
  {
    id: "idea1",
    type: "idea",
    x: 88,
    y: 152,
    w: 260,
    title: "The three-hour rule",
    body: "Three hours of untouched work beats eight hours of half-work. I prove it with one week of my own calendar.",
  },
  {
    id: "hook1",
    type: "hook",
    x: 88,
    y: 348,
    w: 300,
    style: "bold claim",
    text: "You don’t need more hours. You need three that nobody can touch.",
  },
  {
    id: "s1",
    type: "script",
    x: 508,
    y: 152,
    w: 300,
    section: "Cold open",
    text: "Last Tuesday I tracked every minute of an eight hour workday. Two hours and forty minutes of it was actually work. The rest was slack, notifications, and pretending to read a document I had already read. So for one week I capped myself at three hours: no phone, one window, a timer on the desk.",
  },
  {
    id: "s2",
    type: "script",
    x: 508,
    y: 450,
    w: 300,
    section: "Why three",
    text: "Three hours is short enough that you stop negotiating with yourself. There is no afternoon to catch up in, so the first hour has to be the real work. My output did not drop. My editing backlog did.",
  },
  {
    id: "shot1",
    type: "shot",
    x: 856,
    y: 140,
    w: 240,
    text: "Desk at 6am, one window, phone in a drawer. Slow push toward the timer.",
    status: "needed",
    tag: "B-roll",
  },
  {
    id: "titles1",
    type: "titles",
    x: 856,
    y: 300,
    w: 270,
    chosen: "t1",
    items: [
      { id: "t1", text: "The 3-Hour Rule" },
      { id: "t2", text: "I Worked 3 Hours a Day for 30 Days" },
      { id: "t3", text: "Stop Working Eight Hours" },
      { id: "t4", text: "Three Hours, No Phone, One Week" },
    ],
  },
  {
    id: "thumb1",
    type: "thumbnail",
    x: 856,
    y: 560,
    w: 240,
    overlay: "3 HOURS",
  },
  {
    id: "sticky1",
    type: "sticky",
    x: 60,
    y: 604,
    w: 170,
    rotation: -2,
    text: "why three is thin, add the calendar montage",
  },
];

// kind: "vine" | "script"
export const vines = [
  { id: "v1", from: "idea1", to: "hook1", kind: "vine", fromPin: "bottom", toPin: "top" },
  { id: "v2", from: "hook1", to: "s1", kind: "script", fromPin: "right", toPin: "left" },
  { id: "v3", from: "s1", to: "s2", kind: "script", fromPin: "bottom", toPin: "top" },
];

export const strokes = [
  {
    id: "pen1",
    color: "pen",
    width: 1.6,
    points: [
      [238, 650],
      [310, 672],
      [392, 670],
      [452, 652],
      [490, 634],
    ],
    head: [500, 628],
  },
];

// Script path order and the cards hanging off each block.
export const scriptPath = [
  { card: "hook1", label: "Hook", attached: ["idea1"] },
  { card: "s1", label: "Section 1", attached: ["shot1"] },
  { card: "s2", label: "Section 2", attached: ["sticky1"] },
];

export const projects = [
  {
    id: "p_3hour",
    name: "The 3-Hour Rule",
    status: "Outlined",
    meta: "8 cards · edited 2 days ago",
    current: true,
  },
  { id: "p_phone", name: "Seven Days Without a Phone", status: "Scripted", meta: "14 cards · edited 4 days ago" },
  { id: "p_frame", name: "The Frame That Sells", status: "Spark", meta: "3 cards · edited 1 week ago" },
  { id: "p_edit", name: "Editing My First 100 Videos", status: "Filmed", meta: "22 cards · edited 2 weeks ago" },
  { id: "p_notes", name: "Why Notes Die", status: "Published", meta: "11 cards · edited 3 weeks ago" },
];

export const statuses = ["Spark", "Outlined", "Scripted", "Filmed", "Edited", "Published"];
