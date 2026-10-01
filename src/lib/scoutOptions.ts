// src/lib/scoutOptions.ts
// The starter chip lists a scout sheet offers. They live here rather than
// inside the components so the quiz generator can draw its wrong answers
// from the same lists without importing a component.

// Roster tab (per opposing player) and team strengths
export const OFF_STRENGTH_STARTERS: string[] = ["Shooter", "Driver", "Stud", "Post up", "Iso", "Cutter", "Screener", "Rebounder", "Playmaker"];
export const PLAN_TO_GUARD_STARTERS: string[] = ["Pressure", "Contain", "Long closeout", "Short closeout", "Must box", "Be physical"];
export const DEF_STRENGTH_STARTERS: string[] = ["Plays passing lanes well", "Shot blocker", "Takes charges", "Great on-ball defender"];
export const PLAN_TO_ATTACK_STARTERS: string[] = ["Weak on-ball defender", "Poor closeouts", "Doesn't box out", "Foul prone", "Gambles", "Can backdoor"];
export const TEAM_OFF_STRENGTH_STARTERS: string[] = ["Transition", "Ball screens", "Post ups", "Motion", "Iso-heavy", "Offensive rebounding", "3-point volume"];

// Defense tab: press and inbounds defense
export const PRESS_OPTS: string[] = ["Run & Jump", "1-2-1-1", "2-2-1", "1-2-2", "2-1-2", "Trapping"];
export const PRESS_PLAN_OPTS: string[] = ["Diamond", "1-4 zone", "1-4 man"];
export const BLOB_SLOB_D_OPTS: string[] = ["Fight through", "Switch", "2-3", "1-4", "Watch trap"];
export const BLOB_SLOB_D_PLAN_OPTS: string[] = ["Screen your own/slip", "Solid screens", "Screen the zone"];

// Defense tab: primary / secondary (DefenseSection)
export const STRUCTURE_OPTS: string[] = ["Good help", "Hugs", "High ball pressure", "Looks to double", "Overplays"];
export const STRUCTURE_PLAN_OPTS: string[] = ["Look skips", "Look 45", "Crash hard", "Look for backdoors", "Look to flash"];
export const OFF_BALL_OPTS: string[] = ["Switch", "Fight through", "Combo"];
export const OFF_BALL_PLAN_OPTS: string[] = ["Look for slips & screen your own", "Look for curls/refuses"];
export const BALL_SCREEN_OPTS: string[] = ["Ice", "Hedge", "Blitz"];
export const BALL_SCREEN_PLAN_OPTS: string[] = ["Look for flips/re-screens/ghosts/drive the roll", "Look to refuse", "Attack"];
export const ZONE_TYPE_OPTS: string[] = ["2-3", "1-2-2", "1-3-1", "3-2", "Box & 1", "Triangle & 2"];
export const ZONE_STRUCTURE_OPTS: string[] = ["Compact", "Extended", "Traps corners", "Traps wings"];
export const ZONE_PLAN_OPTS: string[] = ["Diamond"];
