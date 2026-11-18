// Bloom — board templates. Placeholder copy is prompt text, never fake facts.

import { makeCard, state } from "./store.js";

const seed = (type, x, y, overrides = {}) => ({ ...makeCard(type, x, y, overrides), placeholder: true });

function link(from, to, kind = "script") {
  return { id: `v_${from.id}_${to.id}_${Math.random().toString(36).slice(2, 6)}`, from: from.id, fromPin: "bottom", to: to.id, toPin: "top", kind };
}

function base(name, status = "Spark") {
  return {
    name,
    status,
    tags: "",
    wpm: 150,
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: [],
    vines: [],
    frames: [],
    strokes: [],
    shapes: [],
  };
}

function outline(board, hookPrompt, sectionPrompts, shotPrompt, titleIdeas) {
  const frame = { id: `f_${Math.random().toString(36).slice(2, 7)}`, label: "Opening", x: 52, y: 116, w: 356, h: 380 };
  const hook = seed("hook", 88, 156, { text: hookPrompt, style: "question" });
  const sections = sectionPrompts.map((text, i) =>
    seed("script", 508, 156 + i * 300, { section: `Section ${i + 1}`, text, w: 320 }),
  );
  const shot = seed("shot", 880, 156, { text: shotPrompt, status: "needed", tag: "B-roll", w: 260 });
  const titles = seed("titles", 880, 330, {
    w: 280,
    chosen: null,
    items: titleIdeas.slice(0, 4).map((text, i) => ({ id: `t_${i}_${Math.random().toString(36).slice(2, 5)}`, text })),
  });
  titles.chosen = titles.items[0].id;
  const thumb = seed("thumbnail", 880, 560, { overlay: "TITLE HERE", w: 260 });

  board.frames.push(frame);
  board.cards.push(hook, shot, titles, thumb, ...sections);
  board.vines.push(
    { id: `v_${hook.id}_${sections[0].id}`, from: hook.id, fromPin: "right", to: sections[0].id, toPin: "left", kind: "script" },
    ...sections.slice(1).map((s, i) => link(sections[i], s)),
    { id: `v_${shot.id}_${sections[0].id}`, from: sections[0].id, fromPin: "right", to: shot.id, toPin: "left", kind: "vine" },
  );
  return board;
}

export const TEMPLATES = [
  {
    id: "blank",
    name: "Blank",
    desc: "An empty board. Nothing but the grid.",
    build: () => base("Untitled board"),
  },
  {
    id: "tutorial",
    name: "Tutorial",
    desc: "Hook, three teaching beats, shot list.",
    build: () =>
      outline(
        base("Tutorial", "Outlined"),
        "What will the viewer be able to do in 5 seconds that they cannot do now?",
        [
          "State the promise, then show the finished result before explaining anything.",
          "The first step. What does the viewer actually do first, and what goes wrong if they skip it?",
          "The second step, and the one mistake you made the first time.",
          "The third step. Close with the smallest version they can try today.",
        ],
        "Screen recording of the first step, cursor visible, no talking.",
        ["The 10-minute fix", "Do this before anything else", "I wish I knew this sooner", "Stop doing it the hard way"],
      ),
  },
  {
    id: "story",
    name: "Story",
    desc: "A single narrative arc with a turn.",
    build: () =>
      outline(
        base("Story", "Outlined"),
        "Start in the middle of the moment everything went wrong.",
        [
          "Set the scene in three sentences: where, who, what was at stake.",
          "The turn. What happened that you did not plan for?",
          "What you did about it, and what it cost.",
          "Where you landed, and the one line the viewer should remember.",
        ],
        "The place it happened, handheld, no music.",
        ["What that week taught me", "I almost quit", "The day it broke", "Nobody saw this coming"],
      ),
  },
  {
    id: "essay",
    name: "Video essay",
    desc: "Argument, evidence, counterpoint.",
    build: () =>
      outline(
        base("Video essay", "Outlined"),
        "State the claim plainly. No wind-up.",
        [
          "The claim, and why it sounds wrong at first.",
          "The evidence: one concrete example, on screen, not described.",
          "The strongest counter-argument, in good faith.",
          "What survives the counter-argument, and what changes.",
        ],
        "Archival clip or document that carries the evidence.",
        ["The case against my own idea", "Everyone is wrong about this", "What the evidence really says", "The counter-argument"],
      ),
  },
  {
    id: "review",
    name: "Review",
    desc: "Verdict first, then the receipts.",
    build: () =>
      outline(
        base("Review", "Outlined"),
        "Give the verdict in the first line, with the price.",
        [
          "Who this is for, and who should skip it.",
          "The one thing it does better than anything else.",
          "Where it falls apart, with footage.",
          "Verdict, alternatives, and what would change your mind.",
        ],
        "Hands-on b-roll: the thing in use, close on the flaw.",
        ["Worth it after 30 days", "The honest review", "Don't buy this yet", "Better than I expected"],
      ),
  },
  {
    id: "short",
    name: "Short (60s)",
    desc: "One beat, one shot, one loop.",
    build: () => {
      const board = base("Short (60s)", "Spark");
      const hook = seed("hook", 120, 160, { text: "Say the most surprising true thing in the first second.", w: 320 });
      const script = seed("script", 520, 160, {
        section: "The beat",
        text: "One idea, 40 to 60 words. Land the turn, then stop talking.",
        w: 320,
      });
      const shot = seed("shot", 900, 160, { text: "One vertical shot, locked off, subject centred.", w: 240 });
      const thumb = seed("thumbnail", 900, 360, { overlay: "ONE LINE", w: 240 });
      board.cards.push(hook, script, shot, thumb);
      board.vines.push(
        { id: `v_${hook.id}_${script.id}`, from: hook.id, fromPin: "right", to: script.id, toPin: "left", kind: "script" },
        { id: `v_${script.id}_${shot.id}`, from: script.id, fromPin: "right", to: shot.id, toPin: "left", kind: "vine" },
      );
      return board;
    },
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
