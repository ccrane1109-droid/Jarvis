/* ==========================================================================
   JARVIS — Discipline tracker: the 30-day program (content and rules).

   Each day has a short lesson in five parts (the principle, why it works, an
   everyday example, what to apply today, and one optional reflection question)
   and 2-3 missions. A mission is checked against what you actually entered
   when it can be ("lock in today's plan", "score your day", "stay under the
   phone target") and says how; the rest you tick yourself and it says so.
   Nothing here is AI: the wording is fixed. Named researchers are cited only
   for findings I'm confident of, and every example is an imagined scenario,
   not a claim about real people. JARVIS only sees what you enter, never your
   phone, so no check claims more than that.

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
  const AUTO_KINDS = ["plan", "ifThen", "timed", "keyDone", "review", "tomorrow", "rule1", "rulesAnswered", "phoneTarget", "avoidUsed"];

  // Missions: { t: text, a: automatic check }. "{target}" in the text becomes that week's phone target.
  const PLAN = { t: "Lock in today's plan", a: "plan" };
  const REVIEW = { t: "Score your day tonight", a: "review" };
  const KEY = { t: "Finish your key task, even a rough version", a: "keyDone" };
  const PHONE = { t: "Stay under {target} hours of screen time", a: "phoneTarget" };
  const TOMORROW = { t: "Plan tomorrow tonight", a: "tomorrow" };
  const RULES_ANSWERED = { t: "Answer your rules in tonight's review", a: "rulesAnswered" };
  const WEEKLY = { t: "Do your weekly review in Trends" };
  const TIMED = { t: "Give every task in your plan a “Due by” time", a: "timed" };
  const AVOIDED = { t: "Use “I'm avoiding it” on Today at least once", a: "avoidUsed" };

  const DAYS = [
    { title: "If-then plans",
      principle: "An if-then plan has the form “If this happens, then I will do that.” Psychologist Peter Gollwitzer studied these as implementation intentions and found that people who make them follow through more often than people who only set a goal.",
      why: "Most plans fail in the moment between knowing and doing. An if-then plan settles that moment in advance, so you aren't bargaining with yourself while you're tired.",
      example: "Picture a student who says “I'll do homework after school.” Now picture one who says “If I walk in the door, then my phone goes on the kitchen charger and I open my homework.” The second plan names a trigger and an action.",
      apply: "Write one if-then for this afternoon in your morning plan. Pick a trigger that is certain to happen.",
      reflect: "What is one thing in your day that happens for certain, that you could hang an if-then plan on?",
      missions: [{ t: "Lock in today's plan with an if-then plan", a: "ifThen" }, { t: "Charge your phone outside your bedroom tonight" }, { t: "Think of something you're waiting on someone for, and message them to agree a due date" }] },
    { title: "The two-minute start",
      principle: "Starting is usually the hardest part of a task. A two-minute start means you only promise two minutes. BJ Fogg, who studies tiny habits, builds habits from steps so small they are hard to refuse.",
      why: "Once you've started, continuing is often easier than it looked from the outside. And on a day you really are wiped, two minutes still counts as showing up.",
      example: "Picture a runner who dreads a long run and tells themselves “just put your shoes on and go to the end of the street.” Often they keep going. On the days they don't, they still ran.",
      apply: "Use “Start 2 minutes” on your key task today. When the timer ends, decide: keep going, or stop having honestly started.",
      reflect: "How hard were the first two minutes, compared with how hard the task felt before you began?",
      missions: [PLAN, { t: "Use “Start 2 minutes” on your key task once today" }, REVIEW] },
    { title: "Environment beats willpower",
      principle: "Researchers such as Wendy Wood have found that a large share of what people do each day is habit, set off by the place and context they're in rather than by a fresh decision.",
      why: "If your phone is in your hand, scrolling is the default. If it's in another room, working is. Changing the setting is easier and more reliable than winning an argument with yourself every time.",
      example: "Picture two students with the same willpower. One studies at a desk with the phone charging in the kitchen. The other studies on the bed with the phone on the pillow. They will probably get different amounts done.",
      apply: "For your first homework block today, put your phone in another room, not just face down.",
      reflect: "Where does your phone usually end up when you are meant to be working, and what is one way to change that?",
      missions: [PLAN, { t: "Phone in another room for your first school work block" }, REVIEW] },
    { title: "Every rep is a vote",
      principle: "Author James Clear describes habits as votes for the kind of person you're becoming. Each time you do what you said you would, you cast a vote for “I keep my promises.”",
      why: "You don't have to feel like a disciplined person first. Your actions build the identity, and the identity makes the next action easier.",
      example: "Picture an athlete who rarely misses a training session, not because every session is fun, but because “I'm someone who trains” is already decided.",
      apply: "Finish your key task today, even a rough version, and tell yourself: that's one vote.",
      reflect: "What is one small thing you did today that fits the person you want to be?",
      missions: [PLAN, KEY, REVIEW] },
    { title: "What you track, you notice",
      principle: "Studies on goal pursuit find that people who monitor their progress, by writing it down or recording it, tend to do better at reaching their goals than people who don't.",
      why: "Without numbers, “I wasted a lot of time” and “I did okay” are both just feelings. Your review gives you something real to look at.",
      example: "Picture someone who thinks they spend an hour on their phone after school. When they finally check Screen Time, it's closer to three. The number changes what they do next.",
      apply: "Open the Trends tab today and read it. Pick one number you want to be different next week.",
      reflect: "Which number in your own record surprised you, and what would you like it to be next week?",
      missions: [PLAN, { t: "Open Trends and pick one number to improve next week" }, REVIEW] },
    { title: "Never miss twice",
      principle: "One missed day is data. Two in a row starts a new pattern. The rule “never miss twice” keeps a bad day from turning into a bad week.",
      why: "After a miss, the risk isn't the miss itself. It's the feeling that the streak is ruined, so you stop. The goal is to get back immediately, even with a smaller version.",
      example: "Picture someone who skips a workout on Tuesday and does a 10-minute version on Wednesday instead of waiting for a perfect day. Their routine survives.",
      apply: "Tonight, plan tomorrow in the Tomorrow tab. If you ever miss a day, the next day's job is just the minimum version.",
      reflect: "What is the smallest version of your routine you could still do on your worst day?",
      missions: [PLAN, REVIEW, TOMORROW] },
    { title: "The weekly review",
      principle: "A short look back each week turns the week into lessons: what worked, what didn't, and one change to try.",
      why: "Daily reviews fix today. A weekly review fixes the system. One small change you actually test beats a big plan you forget.",
      example: "Picture a team that reviews every game and changes one thing each time, compared with a team that only plays. Over a season, the first has a better chance of improving.",
      apply: "Open Trends, then Weekly review. Add one rule you'll test next week.",
      reflect: "What is one thing from this week to keep, and one thing to change?",
      missions: [REVIEW, { t: "Add one rule from the Weekly review", a: "rule1" }, { t: "Read your weekly summary in Trends" }] },

    { title: "Give the task a time",
      principle: "Time blocking means giving a task a specific slot instead of leaving it on a list. A task with a start time is easier to start than one that is just “today.”",
      why: "A to-do list says what. A calendar says when. “When” is what turns an intention into an action.",
      example: "“Do homework” can float all evening. “Homework at 4:00 at the kitchen table” can't.",
      apply: "Give every task in your plan a “Due by” time, early enough that you would have to start before it. When that time arrives, the two-minute start applies.",
      reflect: "Which task keeps floating around without a start time, and what time would suit it?",
      missions: [PLAN, TIMED, KEY] },
    { title: "The planning fallacy",
      principle: "Daniel Kahneman and Amos Tversky described the planning fallacy: people underestimate how long their own tasks will take, even when they know similar tasks ran long before.",
      why: "If your plan only fits on a perfect day, you'll fail it on a normal one and feel behind. Realistic plans protect your confidence.",
      example: "Picture a student who plans to write an essay in 30 minutes because that's how long it should take, then needs 70. Adding buffer would have fit the real day.",
      apply: "Take your key task's estimate and add buffer: if you think 30 minutes, block 45. Then see how close you were.",
      reflect: "Which task recently took longer than you expected, and how much longer?",
      missions: [PLAN, { t: "Block extra time for something you think is quick" }, REVIEW] },
    { title: "Attention residue",
      principle: "Researcher Sophie Leroy found that when you switch from one task to another, part of your attention stays on the first one. She called it attention residue.",
      why: "Checking your phone “just for a second” in the middle of work isn't free. Some of your mind stays on the message while you try to think.",
      example: "Picture reading a chapter and answering a text halfway through. Back at the page, you re-read the same paragraph because your head is still in the chat.",
      apply: "In your focus block today, finish one task before opening anything else. Put your phone out of reach first.",
      reflect: "What pulled your attention away during your focus time, and what could you do about it beforehand?",
      missions: [PLAN, { t: "Finish one task before opening anything else" }, PHONE] },
    { title: "One thing at a time",
      principle: "What feels like multitasking is usually switching quickly between tasks, and each switch costs time and accuracy.",
      why: "Doing one thing properly is usually faster than doing two things badly. It is also less tiring.",
      example: "Picture doing school work with a video playing. The work takes longer, and you only half remember the video.",
      apply: "Pick one task, set a 25-minute timer yourself, and work on just that.",
      reflect: "How did one task with nothing else open feel, compared with how you usually work?",
      missions: [PLAN, { t: "One 25-minute block on one task with nothing else open" }, REVIEW] },
    { title: "Make good easy, bad hard",
      principle: "Behavior tends to follow the path of least effort. Adding a small step in front of a habit you want to cut, and removing steps from one you want to build, changes what you do.",
      why: "Friction is cheaper than willpower. Logging out of an app takes seconds, and that is often enough to stop an automatic open.",
      example: "Picture moving your social apps off the home screen into a folder on the last page, and putting your notes app where they used to be.",
      apply: "Add one step before your biggest time-waster today (log out, move it, or set an App Limit). Remove one step before something you want to do.",
      reflect: "Which step did you add or remove, and did you notice any difference?",
      missions: [PLAN, { t: "Add one step of friction to your biggest phone distraction" }, PHONE] },
    { title: "Why feeds are hard to put down",
      principle: "Behavioral research going back to B. F. Skinner found that rewards arriving unpredictably keep behavior going more strongly than rewards on a fixed schedule. A feed has that shape: most of what you see is forgettable, but you never know whether the next swipe will be great.",
      why: "When the next swipe might be great, trying again always feels worth it. That is not a weak character. Knowing the pattern lets you stop blaming yourself and start designing around it.",
      example: "A slot machine pays out at random and people keep pulling. A feed delivers good posts at random and people keep scrolling.",
      apply: "Notice the moment you pick up your phone for no reason. Say “that's the pull” and use the “I'm avoiding it” button instead.",
      reflect: "When did you last open an app without deciding to, and what were you feeling just before?",
      missions: [PLAN, AVOIDED, REVIEW] },
    { title: "Wanting isn't liking",
      principle: "Neuroscientist Kent Berridge's work separates wanting something from enjoying it. The brain's dopamine system is closely tied to wanting, the pull toward something, which is not the same as pleasure.",
      why: "You can feel a strong pull to scroll and not enjoy it at all. A craving isn't proof the thing will make you feel good.",
      example: "Picture opening an app for the tenth time in an hour. The pull is strong. The enjoyment is close to nothing.",
      apply: "Next time you feel the pull, ask: will I enjoy this, or do I just want it? Wait ten minutes and see if the pull fades.",
      reflect: "Think of the last time you scrolled. Did you enjoy it, or did you mostly want to?",
      missions: [REVIEW, WEEKLY, RULES_ANSWERED] },

    { title: "Deep work",
      principle: "Cal Newport uses the term deep work for focused effort on a demanding task with no distractions. It is the kind of work that tends to produce your best results.",
      why: "Valuable work such as designing, writing and learning needs a long uninterrupted stretch. Shallow tasks fill the day if you let them.",
      example: "Picture one 45-minute block on a design with the phone away, compared with three hours of half-attention. The 45 minutes may well produce more.",
      apply: "Do one 45-minute block on your key task today with your phone in another room. Write down what exists at the end.",
      reflect: "What exists now that did not exist before your focus block?",
      missions: [PLAN, { t: "One 45-minute focus block with your phone in another room" }, PHONE] },
    { title: "Motivation follows action",
      principle: "We tend to wait to feel motivated before starting. Often it works the other way round: starting creates momentum, and the motivation shows up afterward. Therapists use this idea in behavioral activation.",
      why: "If you only act when you feel like it, your results depend on your mood. Acting first makes you independent of it.",
      example: "Picture dragging yourself to practice on a day you felt flat, and feeling better ten minutes in.",
      apply: "Pick the task you least feel like doing and do the two-minute start on it right now.",
      reflect: "How did you feel before you started, and how did you feel a few minutes in?",
      missions: [PLAN, { t: "Do the thing you least feel like doing, for at least two minutes" }, REVIEW] },
    { title: "Delayed gratification is a skill",
      principle: "Waiting for a better reward instead of taking a smaller one now is something you can practice, not only a trait you have or don't.",
      why: "Each time you do the work before the reward, you strengthen the habit of waiting. Phone after the block is the same muscle.",
      example: "Picture a rule: “phone after school work.” At first the wait feels long. After a few weeks, the order feels normal.",
      apply: "Choose one reward you usually take early, such as a video or a snack, and put it after your key task today.",
      reflect: "Which reward did you move until after your key task, and was the wait easier or harder than you expected?",
      missions: [PLAN, { t: "Put one reward after your key task" }, KEY] },
    { title: "Wish, outcome, obstacle, plan",
      principle: "Psychologist Gabriele Oettingen's method, often called WOOP, goes: Wish, Outcome, Obstacle, Plan. Picturing the good result and the real obstacle, then making an if-then plan for the obstacle, tends to work better than positive thinking alone.",
      why: "Daydreaming about success can make it feel as though you've already done part of the work. Naming the obstacle gets you ready for it.",
      example: "Wish: finish my project this week. Outcome: it's ready to show. Obstacle: I scroll after school. Plan: if I get home, then the phone goes on the charger and I work 30 minutes on it.",
      apply: "Pick one goal for this week and write its WOOP in your plan. Your if-then should answer your most likely obstacle.",
      reflect: "What is the most likely obstacle to your goal this week, and what is your if-then for it?",
      missions: [PLAN, { t: "Write a WOOP for this week's goal" }, REVIEW] },
    { title: "Process beats outcome",
      principle: "An outcome goal is a result you can't fully control, like a grade or a number of sales. A process goal is an action you can control, like a 45-minute block every day.",
      why: "You can do your process every day, even when the outcome is out of your hands. Over time the process is what produces the outcome.",
      example: "“Get 10 sales” depends on other people. “Post twice and message five people” depends on you.",
      apply: "Turn one outcome you want into a daily process, and make that your key task.",
      reflect: "What is one outcome you want, and what is one daily action that is fully in your control?",
      missions: [PLAN, { t: "Turn one outcome goal into a daily process and make it your key task" }, KEY] },
    { title: "Sleep and self-control",
      principle: "Poor sleep reduces attention and self-control and makes people more impulsive. Sleep isn't a reward for finishing your work; it is part of what makes the work possible.",
      why: "Staying up late to finish work often makes the next day worse. Protecting your bedtime is a discipline decision.",
      example: "Picture trading an hour of sleep for an hour of scrolling at 11 pm, then struggling to focus at 2 pm.",
      apply: "Tonight, put your phone on the charger outside your bedroom before your bedtime, and note whether you were in bed on time.",
      reflect: "How did last night's sleep show up in your focus today?",
      missions: [PLAN, { t: "Phone out of the bedroom and in bed on time tonight" }, REVIEW] },
    { title: "Rest is part of training",
      principle: "Athletes get stronger during recovery, not during the workout itself. Rest days are part of the plan.",
      why: "Discipline isn't doing the most. It's doing the right amount, consistently. Pushing through constant tiredness leads to burnout or injury.",
      example: "Picture a lifter who trains hard most days and keeps one full rest day, compared with one who never stops and slowly stops improving.",
      apply: "Use the “Planned rest day” type on a day that fits. Rest on purpose, not by accident.",
      reflect: "Where in your week is rest planned, and where is it just happening by accident?",
      missions: [REVIEW, WEEKLY, RULES_ANSWERED] },

    { title: "Urges pass",
      principle: "An urge tends to rise, peak and fall, even if you don't act on it. Addiction researcher Alan Marlatt called riding one out “urge surfing.”",
      why: "An urge can feel as if it will last forever, so people act on it to make it stop. Watching one come and go shows you it doesn't have to be obeyed.",
      example: "Picture the pull to check your phone mid-homework. You notice it, breathe, and keep working, and a little later you realise it has faded.",
      apply: "Next time you feel the pull to grab your phone, wait it out for two minutes before deciding.",
      reflect: "What happened to the urge while you waited?",
      missions: [{ t: "Write your plan in Notes or on paper first, then lock it in here" }, PLAN, REVIEW] },
    { title: "Name it to tame it",
      principle: "Research by Matthew Lieberman and colleagues found that putting a feeling into words can reduce how strongly you feel it.",
      why: "Frustration, boredom and anxiety are often what push people toward their phone. Naming the feeling can take some of its force away.",
      example: "Instead of grabbing the phone when homework feels hard, you say “I'm frustrated and I want an escape.” The naming gives you a second to choose.",
      apply: "Before you pick up your phone today, name the feeling behind it in a few words.",
      reflect: "What feeling was behind your last urge to pick up your phone?",
      missions: [PLAN, { t: "Name the feeling before you pick up your phone, once today" }, PHONE] },
    { title: "Self-compassion after a miss",
      principle: "Research by Kristin Neff and others links treating yourself with understanding after a failure, instead of harsh criticism, with being more willing to try again.",
      why: "Shame tends to make people avoid the thing. A calm “that happened, what do I change?” keeps you in the game.",
      example: "Compare “I'm hopeless, I always do this” with “I missed yesterday. What got in the way, and what's the smallest fix?”",
      apply: "If you miss something today, answer “What got in the way?” in your review and write one fix without insulting yourself.",
      reflect: "What would you say to a friend who missed what you missed, and could you say it to yourself?",
      missions: [PLAN, REVIEW, { t: "If you missed something, write one fix without insulting yourself" }] },
    { title: "The progress principle",
      principle: "Researcher Teresa Amabile found that making progress in meaningful work, even small progress, is one of the strongest boosters of motivation in a workday.",
      why: "Small wins build momentum. That's why a checklist you actually tick off feels good, and why tracking matters.",
      example: "Picture finishing three small tasks and ticking them off: you feel capable, and the fourth is easier to start.",
      apply: "Include one task in today's plan that is small enough to finish early. Tick it and notice how it feels.",
      reflect: "What is one small win from today that you would normally skip past?",
      missions: [PLAN, { t: "Include one task small enough to finish early, and tick it" }, REVIEW] },
    { title: "Tell someone",
      principle: "Telling another person what you plan to do gives you a reason not to quietly drop it. Accountability partners work because dropping a promise is harder when someone knows about it.",
      why: "Private promises are easy to renegotiate. Shared ones usually aren't.",
      example: "Picture telling a friend “I'll send you my draft by Friday.” You now have a reason to finish it.",
      apply: "Share your weekly summary with someone you trust, or tell them one thing you'll do this week and when.",
      reflect: "Who could you tell about your plan this week, and what exactly would you tell them?",
      missions: [PLAN, { t: "Tell one person something specific you'll do this week" }, PHONE] },
    { title: "Stack it on a habit",
      principle: "BJ Fogg's tiny-habits method attaches a new habit to one you already do, using the recipe “After I do X, I will do Y.” James Clear popularized the same idea as habit stacking.",
      why: "An existing habit gives the new one a built-in trigger, so you don't have to remember.",
      example: "“After I brush my teeth at night, I'll write down tomorrow's key task.”",
      apply: "Pick something you already do every day and attach your morning plan or evening review to it.",
      reflect: "What do you already do every day that your plan or review could be attached to?",
      missions: [PLAN, { t: "Attach your plan or review to something you already do every day" }, REVIEW] },
    { title: "The vital few",
      principle: "The Pareto principle says a small share of your activities produces most of your results. You can't know the exact numbers, but the idea holds: some tasks matter far more than others.",
      why: "Being busy isn't the same as making progress. Your key task is the vital one; the rest is support.",
      example: "Picture a business owner who spends hours on small logo tweaks and none on contacting a printer. Only one of those moves the business forward.",
      apply: "Look at your priorities and ask: if only one got done, which would matter most? Make that your key task tomorrow.",
      reflect: "If only one thing got done tomorrow, which one would matter most?",
      missions: [REVIEW, WEEKLY, TOMORROW] },

    { title: "What actually worked",
      principle: "Keep what worked and drop the rest. Looking at your own results tells you more than any general advice.",
      why: "Your own history is the most relevant evidence there is about you.",
      example: "Maybe the days you charged your phone outside the bedroom scored higher. Maybe the two-minute start helped on hard days.",
      apply: "Open Trends for the last 30 days. Find the one or two habits that clearly went with your better days.",
      reflect: "What was usually true on your better days?",
      missions: [REVIEW, { t: "Open Trends (30 days) and note the two things that helped most" }, RULES_ANSWERED] },
    { title: "Your next 90 days",
      principle: "Discipline isn't a month-long project. It is a few systems you keep. The aim of this program was to make you independent of reminders and tracking apps.",
      why: "A system you've tested for 30 days is worth keeping. Anything you haven't used can go.",
      example: "Keep: plan the night before, phone out of the bedroom, the two-minute start. Drop the rest.",
      apply: "Choose your three keepers: rules, habits or times. Remove any rule you don't use, and add one stretch goal in business, school or health.",
      reflect: "Which three things are you keeping, and what is the one goal you want for the next 90 days?",
      missions: [REVIEW, { t: "Pick your 3 keepers and remove any rule you don't use" }, { t: "Write one goal for the next 90 days" }] }
  ];
  DAYS.forEach(function (d, i) { d.day = i + 1; });

  // The five parts of every lesson, in the order they are shown.
  const SECTIONS = [
    { key: "principle", label: "The principle" },
    { key: "why", label: "Why it works" },
    { key: "example", label: "Everyday example" },
    { key: "apply", label: "Apply it today" },
    { key: "reflect", label: "Reflection" }
  ];

  // What each automatic check looks at, in plain words ("{target}" is that week's phone target). Shown with the mission.
  const HOW = {
    plan: "Ticks when today's saved plan has a key task or at least one priority.",
    ifThen: "Ticks when your saved plan note has an “if” or “when” trigger and a “then” or “I will” action. It checks the wording, not whether you follow it.",
    timed: "Ticks when every task in today's saved plan has a “Due by” time.",
    keyDone: "Ticks when your key task is ticked off in today's plan.",
    review: "Ticks when tonight's review is saved and scored.",
    tomorrow: "Ticks when tomorrow has a key task or a priority saved.",
    rule1: "Ticks when a rule is added on this day, in Setup or from the weekly review.",
    rulesAnswered: "Ticks when you answer “done” or “not” on at least one rule in tonight's saved review. You need a rule first.",
    phoneTarget: "Uses the screen-time hours you enter in tonight's review (JARVIS can't see your phone). Ticks at {target} hours or less.",
    avoidUsed: "Ticks when an “I'm avoiding it” entry is logged on this day."
  };
  const HOW_MANUAL = "You tick this yourself. JARVIS can't see it, so it counts on your word.";

  function weekOf(n) { return WEEKS.filter(function (w) { return n >= w.days[0] && n <= w.days[1]; })[0] || WEEKS[WEEKS.length - 1]; }
  function phoneTarget(n) { return weekOf(n).phone; }
  function dateOfDay(start, n) { return L.addDays(start, n - 1); }
  function missionText(m, n) { return m.t.replace("{target}", String(phoneTarget(n))); }
  function missionHow(m, n) { return m.a ? HOW[m.a].replace("{target}", String(phoneTarget(n))) : HOW_MANUAL; }

  // Where today is in the program: { status: "notStarted" | "active" | "complete", day }.
  function programDay(start, todayISO) {
    if (!start || todayISO < start) return { status: "notStarted", day: 0 };
    const n = L.daysBetween(start, todayISO) + 1;
    return n > DAYS.length ? { status: "complete", day: n } : { status: "active", day: n };
  }

  // When a day's lesson opens: its date on the calendar, and how many days from today that is (0 = today, negative = open).
  function unlock(start, n, todayISO) {
    const date = dateOfDay(start, n);
    return { date: date, inDays: L.daysBetween(todayISO, date) };
  }

  const hasText = function (t) { return !!t && !!t.text; };

  // Is one mission done? Automatic ones look at what was entered for that day; the rest are ticked by hand.
  //   ctx: { date, days, rules, avoid, manualDone: [indexes ticked], dayNumber }
  function missionDone(m, index, ctx) {
    if (!m.a) return ctx.manualDone.indexOf(index) !== -1;
    const day = L.sanitizeDay(ctx.days[ctx.date]);
    const morning = day.morning;
    const planned = !!morning && (hasText(morning.keyTask) || morning.priorities.some(hasText));
    const scored = L.scoreDay(day).complete;
    if (m.a === "plan") return planned;
    if (m.a === "ifThen") return !!morning && L.hasIfThen(morning.plan);
    if (m.a === "timed") {
      if (!morning) return false;
      const items = [morning.keyTask].concat(morning.priorities).filter(hasText);
      return items.length > 0 && items.every(function (t) { return !!t.due; });
    }
    if (m.a === "keyDone") return !!morning && !!morning.keyTask.text && morning.keyTask.done;
    if (m.a === "review") return scored;
    if (m.a === "tomorrow") { const t = L.sanitizeDay(ctx.days[L.addDays(ctx.date, 1)]); return !!t.morning && (hasText(t.morning.keyTask) || t.morning.priorities.some(hasText)); }
    if (m.a === "rule1") return (ctx.rules || []).some(function (r) { return L.ruleAddedDate(r) === ctx.date; });
    if (m.a === "rulesAnswered") return !!day.review && day.review.rules.some(function (r) { return r.state === "done" || r.state === "not"; });
    if (m.a === "phoneTarget") return scored && day.review.items.phone !== "na" && day.review.screenHours !== null && day.review.screenHours <= phoneTarget(ctx.dayNumber);
    if (m.a === "avoidUsed") return (ctx.avoid || []).some(function (a) { return a.date === ctx.date; });
    return false;
  }

  // Something the person has to do before an automatic mission can ever tick, or "".
  function missionNeeds(m, ctx) {
    if (m.a === "rulesAnswered" && !(ctx.rules || []).length) return "Needs a rule. Add one in Setup first.";
    return "";
  }

  // The day's missions with their status: { done, total, items: [{ text, auto, done, how, needs }] }.
  function dayProgress(n, ctx) {
    const entry = DAYS[n - 1];
    const full = Object.assign({}, ctx, { dayNumber: n });
    const items = entry.missions.map(function (m, i) {
      const done = missionDone(m, i, full);
      return { text: missionText(m, n), auto: !!m.a, kind: m.a || "", done: done, how: missionHow(m, n), needs: done ? "" : missionNeeds(m, full) };
    });
    return { done: items.filter(function (x) { return x.done; }).length, total: items.length, items: items };
  }

  // The whole program at a glance, for the overview. ctxFor(n) gives the context for day n (see missionDone).
  //   -> { status, day, week, title, today, unlocked, finished, missionsDone, missionsTotal, reflections, upcoming }
  function overview(program, todayISO, ctxFor) {
    const pd = programDay(program.start, todayISO);
    const open = pd.status === "notStarted" ? 0 : Math.min(pd.day, DAYS.length);
    let finished = 0, missionsDone = 0, missionsTotal = 0;
    for (let n = 1; n <= open; n++) {
      const p = dayProgress(n, ctxFor(n));
      missionsDone += p.done; missionsTotal += p.total;
      if (p.total && p.done === p.total) finished++;
    }
    const entry = pd.status === "active" ? DAYS[pd.day - 1] : null;
    const upcoming = [];
    if (pd.status === "active") {
      for (let n = pd.day + 1; n <= DAYS.length && upcoming.length < 3; n++) upcoming.push({ day: n, title: DAYS[n - 1].title, date: dateOfDay(program.start, n), inDays: n - pd.day });
    }
    return {
      status: pd.status, day: pd.day, week: pd.status === "active" ? weekOf(pd.day) : null, title: entry ? entry.title : "",
      today: pd.status === "active" ? dayProgress(pd.day, ctxFor(pd.day)) : null,
      unlocked: open, finished: finished, missionsDone: missionsDone, missionsTotal: missionsTotal,
      reflections: Object.keys(program.reflections || {}).length, upcoming: upcoming
    };
  }

  return {
    WEEKS: WEEKS, DAYS: DAYS, AUTO_KINDS: AUTO_KINDS, SECTIONS: SECTIONS, HOW: HOW, HOW_MANUAL: HOW_MANUAL,
    weekOf: weekOf, phoneTarget: phoneTarget, dateOfDay: dateOfDay, unlock: unlock, programDay: programDay,
    missionDone: missionDone, missionText: missionText, missionHow: missionHow, dayProgress: dayProgress, overview: overview
  };
});
