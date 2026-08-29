// The chat page's empty-state greeting.
//
// Seventy-two strings, which is why they are not in the page any more: as a
// literal inside Chat.jsx they were 80 of its 704 lines, and because one is
// picked at random on every fresh chat they also made screenshot diffs of the
// chat routes drift by up to 3.4% between two builds of identical code. Here
// they are data, and a test or a screenshot rig can stub this module.

// Empty-state greeting, swapped in per new chat. Mostly not about the time of
// day — a handful per period nod to it (capped at 5) so it doesn't read as a
// gimmick that's always talking about the clock.
export const GREETINGS = {
  morning: [
    'Morning, sir.',
    'Good morning — try not to open forty tabs before breakfast.',
    'Early start, sir?',
    "The coffee's fresh; so is the morning queue.",
    'Up with the sun, or fighting it?',
    "Right then — where do we begin?",
    'Standing by, as ever.',
    'Systems nominal. You, less certain — go on then.',
    "Another queue, another day. Let's clear it.",
    "I've been awake the whole time. You get the excuse.",
    'At your service, sir.',
    "Whenever you're ready.",
    "Let's make today's list somebody else's problem.",
    "You bring the questions, I'll bring the follow-through.",
    'First request — no pressure.',
    'Onwards.',
    "I've kept the seat warm.",
    "Let's not overthink the first ten minutes.",
    'Say the word.',
    "No fires so far. Let's keep it that way.",
    'Fresh terminal, clean slate.',
    'Shall we?',
    "I've been idling productively.",
    'Consider me caffeinated in spirit, if nothing else.',
  ],
  midday: [
    'Halfway through the day and still unbothered.',
    'Afternoon lull? Not on my watch.',
    "Midday check-in — what's on the docket?",
    "The day's second half starts now.",
    'Post-lunch fog is a you problem, not a me problem.',
    'Say the word.',
    'Standing by.',
    "What's next on the list?",
    "I've been idling productively.",
    'Right, what\'s the crisis today?',
    "You've survived the hard part. Onwards.",
    "Let's turn 'later' into 'done'.",
    'Go on, then.',
    "I'm listening.",
    "Whatever's next, I'm across it.",
    'Ready and, dare I say, a little bored.',
    'Consider me at your disposal.',
    'One task or twelve — makes no difference to me.',
    "Shall we get on with it?",
    'Feed me a problem.',
    'Still here. Still capable.',
    "Momentum's a fragile thing. Let's not lose it.",
    "Whatever you're stuck on, I probably have opinions.",
    'Your move, sir.',
  ],
  night: [
    'Burning those midnight tokens?',
    'Still up, I see.',
    'Night owl mode: engaged.',
    "The world's asleep. We're not.",
    'Late one, sir?',
    'No judgment. Just data.',
    "Let's make this quick and painless.",
    "I don't sleep, so I don't mind.",
    "Let's get this sorted so you can actually rest.",
    'At your service, whatever the hour.',
    'Quiet hours, focused work.',
    "You're here. I'm here. Let's not waste it.",
    'Say the word.',
    'Fewer distractions right now, at least.',
    'Onwards, into the quiet.',
    "I'll keep the lights on, figuratively.",
    'Whenever inspiration strikes, apparently.',
    'No rush. Also, definitely some rush.',
    "Let's be efficient about this.",
    'The house is quiet. Good time to think.',
    "I've got nowhere else to be.",
    'Consider me undistracted.',
    "Let's wrap this up before it wraps around you.",
    "Whatever's keeping you up, let's make it worth it.",
  ],
}

export function pickGreeting() {
  const h = new Date().getHours()
  const period = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'midday' : 'night'
  const list = GREETINGS[period]
  return list[Math.floor(Math.random() * list.length)]
}
