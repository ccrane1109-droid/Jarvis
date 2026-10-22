/* ==========================================================================
   JARVIS — Discipline tracker: the 30-day program (content and rules).

   Each day has a short lesson (the principle, why it matters, a pictured
   example, how to apply it now) and 2-3 missions. A mission is checked
   against what you actually entered when it can be ("lock in today's plan",
   "score your day", "stay under the phone target"); the rest you tick
   yourself. Nothing here is AI: the wording is fixed. Named researchers are
   cited only for findings I'm confident of, and every "picture this" example
   is an imagined scenario, not a claim about real people.

   Four weeks of focus, then two days of review:
     1 Make it visible   2 Build the block   3 Raise the bar   4 Go independent   (29-30) Review and renew
   The weekly phone target steps down 5 -> 4 -> 3.5 -> 3 hours. It is a
   target you can adopt with one tap, never something JARVIS sets for you.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./discipline-logic"));
  else root.JarvisDisciplineProgram = factory(root.JarvisDisciplineLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const WEEKS = [
    { n: 1, name: "Make it visible", days: [1, 7], phone: 5, focus: "Plan every day, review every night, and change just two things: your school work before your phone, and your phone charging outside your bedroom. You can't fix what you can't see." },
    { n: 2, name: "Build the block", days: [8, 14], phone: 4, focus: "Give your most important task a fixed daily block with a start time and something to show at the end. Use the two-minute start on days you don't feel like it." },
    { n: 3, name: "Raise the bar", days: [15, 21], phone: 3.5, focus: "Longer focus blocks, one hard thing a day, and practice getting back on track fast after a bad day." },
    { n: 4, name: "Go independent", days: [22, 28], phone: 3, focus: "Write your own plan first, then check it. The aim is that you don't need this app, or anyone, to get started." },
    { n: 5, name: "Review and renew", days: [29, 30], phone: 3, focus: "Look at what actually worked and keep only that." }
  ];
  const AUTO_KINDS = ["plan", "ifThen", "keyDone", "review", "tomorrow", "rule1", "rulesAnswered", "phoneTarget"];

  // Missions: { t: text, a: automatic check }. "{target}" in the text becomes that week's phone target.
  const PLAN = { t: "Lock in today's plan", a: "plan" };
  const REVIEW = { t: "Score your day tonight", a: "review" };
  const KEY = { t: "Finish your key task, even a rough version", a: "keyDone" };
  const PHONE = { t: "Stay under {target} hours of screen time", a: "phoneTarget" };
  const TOMORROW = { t: "Plan tomorrow tonight", a: "tomorrow" };
  const RULES_ANSWERED = { t: "Answer your rules in tonight's review", a: "rulesAnswered" };
  const WEEKLY = { t: "Do your weekly review in Trends" };

  const DAYS = [
    { title: "If-then plans",
      principle: "An if-then plan has the form “If this happens, then I will do that.” Psychologist Peter Gollwitzer studied these as implementation intentions and found that people who make them follow through more often than people who only set a goal.",
      why: "Most plans fail in the moment between knowing and doing. An if-then plan settles that moment in advance, so you aren't bargaining with yourself while you're tired.",
      example: "Picture a student who says “I'll do homework after school.” Now picture one who says “If I walk in the door, then my phone goes on the kitchen charger and I open my homework.” The second plan names a trigger and an action.",
      apply: "Write one if-then for this afternoon in your morning plan. Pick a trigger that is certain to happen.",
      missions: [{ t: "Lock in today's plan with an if-then plan", a: "ifThen" }, { t: "Charge your phone outside your bedroom tonight" }, { t: "Think of something you're waiting on someone for, and message them to agree a due date" }] },
    { title: "The two-minute start",
      principle: "Starting is usually the hardest part of a task. A two-minute start means you only promise two minutes. BJ Fogg, who studies tiny habits, builds habits from steps so small they are hard to refuse.",
      why: "Once you've started, continuing is often easier than it looked from the outside. And on a day you really are wiped, two minutes still counts as showing up.",
      example: "Picture a runner who dreads a long run and tells themselves “just put your shoes on and go to the end of the street.” Often they keep going. On the days they don't, they still ran.",
      apply: "Use “Start 2 minutes” on your key task today. When the timer ends, decide: keep going, or stop having honestly started.",
      missions: [PLAN, { t: "Use “Start 2 minutes” on your key task once today" }, REVIEW] },
    { title: "Environment beats willpower",
      principle: "Researchers such as Wendy Wood have found that a large share of what people do each day is habit, set off by the place and context they're in rather than by a fresh decision.",
      why: "If your phone is in your hand, scrolling is the default. If it's in another room, working is. Changing the setting is easier and more reliable than winning an argument with yourself every time.",
      example: "Picture two students with the same willpower. One studies at a desk with the phone charging in the kitchen. The other studies on the bed with the phone on the pillow. They will probably get different amounts done.",
      apply: "For your first homework block today, put your phone in another room, not just face down.",
      missions: [PLAN, { t: "Phone in another room for your first school work block" }, REVIEW] },
    { title: "Every rep is a vote",
      principle: "Author James Clear describes habits as votes for the kind of person you're becoming. Each time you do what you said you would, you cast a vote for “I keep my promises.”",
      why: "You don't have to feel like a disciplined person first. Your actions build the identity, and the identity makes the next action easier.",
      example: "Picture an athlete who rarely misses a training session, not because every session is fun, but because “I'm someone who trains” is already decided.",
      apply: "Finish your key task today, even a rough version, and tell yourself: that's one vote.",
      missions: [PLAN, KEY, REVIEW] },
    { title: "What you track, you notice",
      principle: "Studies on goal pursuit find that people who monitor their progress, by writing it down or recording it, tend to do better at reaching their goals than people who don't.",
      why: "Without numbers, “I wasted a lot of time” and “I did okay” are both just feelings. Your review gives you something real to look at.",
      example: "Picture someone who thinks they spend an hour on their phone after school. When they finally check Screen Time, it's closer to three. The number changes what they do next.",
      apply: "Open the Trends tab today and read it. Pick one number you want to be different next week.",
      missions: [PLAN, { t: "Open Trends and pick one number to improve next week" }, REVIEW] },
    { title: "Never miss twice",
      principle: "One missed day is data. Two in a row starts a new pattern. The rule “never miss twice” keeps a bad day from turning into a bad week.",
      why: "After a miss, the risk isn't the miss itself. It's the feeling that the streak is ruined, so you stop. The goal is to get back immediately, even with a smaller version.",
      example: "Picture someone who skips a workout on Tuesday and does a 10-minute version on Wednesday instead of waiting for a perfect day. Their routine survives.",
      apply: "Tonight, plan tomorrow in the Tomorrow tab. If you ever miss a day, the next day's job is just the minimum version.",
      missions: [PLAN, REVIEW, TOMORROW] },
    { title: "The weekly review",
      principle: "A short look back each week turns the week into lessons: what worked, what didn't, and one change to try.",
      why: "Daily reviews fix today. A weekly review fixes the system. One small change you actually test beats a big plan you forget.",
      example: "Picture a team that reviews every game and changes one thing each time, compared with a team that only plays. Over a season, the first has a better chance of improving.",
      apply: "Open Trends, then Weekly review. Add one rule you'll test next week.",
      missions: [REVIEW, { t: "Add one rule from the Weekly review", a: "rule1" }, { t: "Read your weekly summary in Trends" }] },

    { title: "Give the task a time",
      principle: "Time blocking means giving a task a specific slot instead of leaving it on a list. A task with a start time is easier to start than one that is just “today.”",
      why: "A to-do list says what. A calendar says when. “When” is what turns an intention into an action.",
      example: "“Do homework” can float all evening. “Homework at 4:00 at the kitchen table” can't.",
      apply: "Next to each priority in your plan, write a start time. When that time arrives, the two-minute start applies.",
      missions: [PLAN, { t: "Write a start time next to every priority" }, KEY] },
    { title: "The planning fallacy",
      principle: "Daniel Kahneman and Amos Tversky described the planning fallacy: people underestimate how long their own tasks will take, even when they know similar tasks ran long before.",
      why: "If your plan only fits on a perfect day, you'll fail it on a normal one and feel behind. Realistic plans protect your confidence.",
      example: "Picture a student who plans to write an essay in 30 minutes because that's how long it should take, then needs 70. Adding buffer would have fit the real day.",
      apply: "Take your key task's estimate and add buffer: if you think 30 minutes, block 45. Then see how close you were.",
      missions: [PLAN, { t: "Block extra time for something you think is quick" }, REVIEW] },
    { title: "Attention residue",
      principle: "Researcher Sophie Leroy found that when you switch from one task to another, part of your attention stays on the first one. She called it attention residue.",
      why: "Checking your phone “just for a second” in the middle of work isn't free. Some of your mind stays on the message while you try to think.",
      example: "Picture reading a chapter and answering a text halfway through. Back at the page, you re-read the same paragraph because your head is still in the chat.",
      apply: "In your focus block today, finish one task before opening anything else. Put your phone out of reach first.",
      missions: [PLAN, { t: "Finish one task before opening anything else" }, PHONE] },
    { title: "One thing at a time",
      principle: "What feels like multitasking is usually switching quickly between tasks, and each switch costs time and accuracy.",
      why: "Doing one thing properly is usually faster than doing two things badly. It is also less tiring.",
      example: "Picture doing school work with a video playing. The work takes longer, and you only half remember the video.",
      apply: "Pick one task, set a 25-minute timer yourself, and work on just that.",
      missions: [PLAN, { t: "One 25-minute block on one task with nothing else open" }, REVIEW] },
    { title: "Make good easy, bad hard",
      principle: "Behavior tends to follow the path of least effort. Adding a small step in front of a habit you want to cut, and removing steps from one you want to build, changes what you do.",
      why: "Friction is cheaper than willpower. Logging out of an app takes seconds, and that is often enough to stop an automatic open.",
      example: "Picture moving your social apps off the home screen into a folder on the last page, and putting your notes app where they used to be.",
      apply: "Add one step before your biggest time-waster today (log out, move it, or set an App Limit). Remove one step before something you want to do.",
      missions: [PLAN, { t: "Add one step of friction to your biggest phone distraction" }, PHONE] },
    { title: "Why feeds are hard to put down",
      principle: "Rewards that arrive unpredictably keep behavior going more strongly than rewards on a fixed schedule. Many feeds and short-video apps are designed this way: you never know whether the next swipe will be great.",
      why: "It isn't a weak character. A design built to make the next swipe feel worth trying is hard to resist. Knowing that lets you stop blaming yourself and start designing around it.",
      example: "A slot machine pays out at random and people keep pulling. A feed delivers good posts at random and people keep scrolling.",
      apply: "Notice the moment you pick up your phone for no reason. Say “that's the pull” and use the “I'm avoiding it” button instead.",
      missions: [PLAN, { t: "When you pick up your phone for no reason, use “I'm avoiding it” instead" }, REVIEW] },
    { title: "Wanting isn't liking",
      principle: "Neuroscientist Kent Berridge's work separates wanting something from enjoying it. The brain's dopamine system is closely tied to wanting, the pull toward something, which is not the same as pleasure.",
      why: "You can feel a strong pull to scroll and not enjoy it at all. A craving isn't proof the thing will make you feel good.",
      example: "Picture opening an app for the tenth time in an hour. The pull is strong. The enjoyment is close to nothing.",
      apply: "Next time you feel the pull, ask: will I enjoy this, or do I just want it? Wait ten minutes and see if the pull fades.",
      missions: [REVIEW, WEEKLY, RULES_ANSWERED] },

    { title: "Deep work",
      principle: "Cal Newport uses the term deep work for focused effort on a demanding task with no distractions. It is the kind of work that tends to produce your best results.",
      why: "Valuable work such as designing, writing and learning needs a long uninterrupted stretch. Shallow tasks fill the day if you let them.",
      example: "Picture one 45-minute block on a design with the phone away, compared with three hours of half-attention. The 45 minutes may well produce more.",
      apply: "Do one 45-minute block on your key task today with your phone in another room. Write down what exists at the end.",
      missions: [PLAN, { t: "One 45-minute focus block with your phone in another room" }, PHONE] },
    { title: "Motivation follows action",
      principle: "We tend to wait to feel motivated before starting. Often it works the other way round: starting creates momentum, and the motivation shows up afterward. Therapists use this idea in behavioral activation.",
      why: "If you only act when you feel like it, your results depend on your mood. Acting first makes you independent of it.",
      example: "Picture dragging yourself to practice on a day you felt flat, and feeling better ten minutes in.",
      apply: "Pick the task you least feel like doing and do the two-minute start on it right now.",
      missions: [PLAN, { t: "Do the thing you least feel like doing, for at least two minutes" }, REVIEW] },
    { title: "Delayed gratification is a skill",
      principle: "Waiting for a better reward instead of taking a smaller one now is a skill that can be practiced, not only a trait you have or don't.",
      why: "Each time you do the work before the reward, you strengthen the habit of waiting. Phone after the block is the same muscle.",
      example: "Picture a rule: “phone after school work.” At first the wait feels long. After a few weeks, the order feels normal.",
      apply: "Choose one reward you usually take early, such as a video or a snack, and put it after your key task today.",
      missions: [PLAN, { t: "Put one reward after your key task" }, KEY] },
    { title: "Wish, outcome, obstacle, plan",
      principle: "Psychologist Gabriele Oettingen's method, often called WOOP, goes: Wish, Outcome, Obstacle, Plan. Picturing the good result and the real obstacle, then making an if-then plan for the obstacle, tends to work better than positive thinking alone.",
      why: "Daydreaming about success can make it feel as though you've already done part of the work. Naming the obstacle gets you ready for it.",
      example: "Wish: finish my project this week. Outcome: it's ready to show. Obstacle: I scroll after school. Plan: if I get home, then the phone goes on the charger and I work 30 minutes on it.",
      apply: "Pick one goal for this week and write its WOOP in your plan. Your if-then should answer your most likely obstacle.",
      missions: [PLAN, { t: "Write a WOOP for this week's goal" }, REVIEW] },
    { title: "Process beats outcome",
      principle: "An outcome goal is a result you can't fully control, like a grade or a number of sales. A process goal is an action you can control, like a 45-minute block every day.",
      why: "You can do your process every day, even when the outcome is out of your hands. Over time the process is what produces the outcome.",
      example: "“Get 10 sales” depends on other people. “Post twice and message five people” depends on you.",
      apply: "Turn one outcome you want into a daily process, and make that your key task.",
      missions: [PLAN, { t: "Turn one outcome goal into a daily process and make it your key task" }, KEY] },
    { title: "Sleep and self-control",
      principle: "Poor sleep reduces attention and self-control and makes people more impulsive. Sleep isn't a reward for finishing your work; it is part of what makes the work possible.",
      why: "Staying up late to finish work often makes the next day worse. Protecting your bedtime is a discipline decision.",
      example: "Picture trading an hour of sleep for an hour of scrolling at 11 pm, then struggling to focus at 2 pm.",
      apply: "Tonight, put your phone on the charger outside your bedroom before your bedtime, and note whether you were in bed on time.",
      missions: [PLAN, { t: "Phone out of the bedroom and in bed on time tonight" }, REVIEW] },
    { title: "Rest is part of training",
      principle: "Athletes get stronger during recovery, not during the workout itself. Rest days are part of the plan.",
      why: "Discipline isn't doing the most. It's doing the right amount, consistently. Pushing through constant tiredness leads to burnout or injury.",
      example: "Picture a lifter who trains hard most days and keeps one full rest day, compared with one who never stops and slowly stops improving.",
      apply: "Use the “Planned rest day” type on a day that fits. Rest on purpose, not by accident.",
      missions: [REVIEW, WEEKLY, RULES_ANSWERED] },

    { title: "Urges pass",
      principle: "An urge usually rises, peaks and falls, often within minutes, even if you don't act on it. Addiction researcher Alan Marlatt called riding one out “urge surfing.”",
      why: "Many people act on an urge because it feels like it will last forever. Watching it come and go shows you that it doesn't.",
      example: "Picture the pull to check your phone mid-homework. You notice it, breathe, and keep working. Two minutes later it has faded.",
      apply: "Next time you feel the pull to grab your phone, wait it out for two minutes before deciding.",
      missions: [{ t: "Write your plan in Notes or on paper first, then lock it in here" }, PLAN, REVIEW] },
    { title: "Name it to tame it",
      principle: "Research by Matthew Lieberman and colleagues found that putting a feeling into words can reduce how strongly you feel it.",
      why: "Frustration, boredom and anxiety are often what push people toward their phone. Naming the feeling can take some of its force away.",
      example: "Instead of grabbing the phone when homework feels hard, you say “I'm frustrated and I want an escape.” The naming gives you a second to choose.",
      apply: "Before you pick up your phone today, name the feeling behind it in a few words.",
      missions: [PLAN, { t: "Name the feeling before you pick up your phone, once today" }, PHONE] },
    { title: "Self-compassion after a miss",
      principle: "Research by Kristin Neff and others links treating yourself with understanding after a failure, instead of harsh criticism, with being more willing to try again.",
      why: "Shame tends to make people avoid the thing. A calm “that happened, what do I change?” keeps you in the game.",
      example: "Compare “I'm hopeless, I always do this” with “I missed yesterday. What got in the way, and what's the smallest fix?”",
      apply: "If you miss something today, answer “What got in the way?” in your review and write one fix without insulting yourself.",
      missions: [PLAN, REVIEW, { t: "If you missed something, write one fix without insulting yourself" }] },
    { title: "The progress principle",
      principle: "Researcher Teresa Amabile found that making progress in meaningful work, even small progress, is one of the strongest boosters of motivation in a workday.",
      why: "Small wins build momentum. That's why a checklist you actually tick off feels good, and why tracking matters.",
      example: "Picture finishing three small tasks and ticking them off: you feel capable, and the fourth is easier to start.",
      apply: "Include one task in today's plan that is small enough to finish early. Tick it and notice how it feels.",
      missions: [PLAN, { t: "Include one task small enough to finish early, and tick it" }, REVIEW] },
    { title: "Tell someone",
      principle: "Telling another person what you plan to do gives you a reason not to quietly drop it. Accountability partners work because dropping a promise is harder when someone knows about it.",
      why: "Private promises are easy to renegotiate. Shared ones usually aren't.",
      example: "Picture telling a friend “I'll send you my draft by Friday.” You now have a reason to finish it.",
      apply: "Share your weekly summary with someone you trust, or tell them one thing you'll do this week and when.",
      missions: [PLAN, { t: "Tell one person something specific you'll do this week" }, PHONE] },
    { title: "Stack it on a habit",
      principle: "BJ Fogg's tiny-habits method attaches a new habit to one you already do, using the recipe “After I do X, I will do Y.” James Clear popularized the same idea as habit stacking.",
      why: "An existing habit gives the new one a built-in trigger, so you don't have to remember.",
      example: "“After I brush my teeth at night, I'll write down tomorrow's key task.”",
      apply: "Pick something you already do every day and attach your morning plan or evening review to it.",
      missions: [PLAN, { t: "Attach your plan or review to something you already do every day" }, REVIEW] },
    { title: "The vital few",
      principle: "The Pareto principle says a small share of your activities produces most of your results. You can't know the exact numbers, but the idea holds: some tasks matter far more than others.",
      why: "Being busy isn't the same as making progress. Your key task is the vital one; the rest is support.",
      example: "Picture a business owner who spends hours on small logo tweaks and none on contacting a printer. Only one of those moves the business forward.",
      apply: "Look at your priorities and ask: if only one got done, which would matter most? Make that your key task tomorrow.",
      missions: [REVIEW, WEEKLY, TOMORROW] },

    { title: "What actually worked",
      principle: "Keep what worked and drop the rest. Looking at your own results tells you more than any general advice.",
      why: "Your own history is the most relevant evidence there is about you.",
      example: "Maybe the days you charged your phone outside the bedroom scored higher. Maybe the two-minute start helped on hard days.",
      apply: "Open Trends for the last 30 days. Find the one or two habits that clearly went with your better days.",
      missions: [REVIEW, { t: "Open Trends (30 days) and note the two things that helped most" }, RULES_ANSWERED] },
    { title: "Your next 90 days",
      principle: "Discipline isn't a month-long project. It is a few systems you keep. The aim of this program was to make you independent of reminders and tracking apps.",
      why: "A system you've tested for 30 days is worth keeping. Anything you haven't used can go.",
      example: "Keep: plan the night before, phone out of the bedroom, the two-minute start. Drop the rest.",
      apply: "Choose your three keepers: rules, habits or times. Remove any rule you don't use, and add one stretch goal in business, school or health.",
      missions: [REVIEW, { t: "Pick your 3 keepers and remove any rule you don't use" }, { t: "Write one goal for the next 90 days" }] }
  ];
  DAYS.forEach(function (d, i) { d.day = i + 1; });

  function weekOf(n) { return WEEKS.filter(function (w) { return n >= w.days[0] && n <= w.days[1]; })[0] || WEEKS[WEEKS.length - 1]; }
  function phoneTarget(n) { return weekOf(n).phone; }
  function dateOfDay(start, n) { return L.addDays(start, n - 1); }
  function missionText(m, n) { return m.t.replace("{target}", String(phoneTarget(n))); }

  // Where today is in the program: { status: "notStarted" | "active" | "complete", day }.
  function programDay(start, todayISO) {
    if (!start || todayISO < start) return { status: "notStarted", day: 0 };
    const n = L.daysBetween(start, todayISO) + 1;
    return n > DAYS.length ? { status: "complete", day: n } : { status: "active", day: n };
  }

  // Is one mission done? Automatic ones look at what was entered for that day; the rest are ticked by hand.
  //   ctx: { date, days, rules, manualDone: [indexes ticked], dayNumber }
  function missionDone(m, index, ctx) {
    if (!m.a) return ctx.manualDone.indexOf(index) !== -1;
    const day = L.sanitizeDay(ctx.days[ctx.date]);
    const planned = !!day.morning && (!!day.morning.keyTask.text || day.morning.priorities.some(function (p) { return !!p.text; }));
    const scored = L.scoreDay(day).complete;
    if (m.a === "plan") return planned;
    if (m.a === "ifThen") return !!day.morning && day.morning.plan.length >= 3;
    if (m.a === "keyDone") return !!day.morning && !!day.morning.keyTask.text && day.morning.keyTask.done;
    if (m.a === "review") return scored;
    if (m.a === "tomorrow") { const t = L.sanitizeDay(ctx.days[L.addDays(ctx.date, 1)]); return !!t.morning && (!!t.morning.keyTask.text || t.morning.priorities.some(function (p) { return !!p.text; })); }
    if (m.a === "rule1") return ctx.rules.length >= 1;
    if (m.a === "rulesAnswered") return !!day.review && day.review.rules.some(function (r) { return r.state === "done" || r.state === "not"; });
    if (m.a === "phoneTarget") return scored && day.review.items.phone !== "na" && day.review.screenHours !== null && day.review.screenHours <= phoneTarget(ctx.dayNumber);
    return false;
  }

  // The day's missions with their status: { done, total, items: [{ text, auto, done }] }.
  function dayProgress(n, ctx) {
    const entry = DAYS[n - 1];
    const items = entry.missions.map(function (m, i) {
      return { text: missionText(m, n), auto: !!m.a, done: missionDone(m, i, Object.assign({}, ctx, { dayNumber: n })) };
    });
    return { done: items.filter(function (x) { return x.done; }).length, total: items.length, items: items };
  }

  return { WEEKS: WEEKS, DAYS: DAYS, AUTO_KINDS: AUTO_KINDS, weekOf: weekOf, phoneTarget: phoneTarget, dateOfDay: dateOfDay, programDay: programDay, missionDone: missionDone, missionText: missionText, dayProgress: dayProgress };
});
