# Worked example

Files: a photo of a notice board, a screenshot of a class group chat, the course plan PDF, personal notes.

```bash
$ node scripts/contextos.mjs brief notice_board_ia2.jpg class_group_chat.png dbms_course_plan.pdf my_notes.txt
Reading 4 file(s) with Gemma 4…
  notice_board_ia2.jpg: Reading image with Gemma 4
  …
# DBMS IA-2 and Lab Clash

The IA-2 exam and the DBMS lab viva are both set for the same morning…

## Conflicts
- IA-2 DBMS exam on 29 Oct, 10:00–11:30 **vs** DBMS lab viva on 29 Oct at 10:00: both at 10:00 on the same day _(verified by code)_ [F1][F6]

## Missing information
- (high) Which room is the IA-2 exam in?: the notice gives no room → ask the class rep [F1]
…
```

Follow-up:

```bash
$ node scripts/contextos.mjs ask "What should I tell the lab instructor?"
```

Actions (proposals only):

```bash
$ node scripts/contextos.mjs actions --ics ia2.ics
# Proposed actions (approve before acting)
- 📅 **IA-2 DBMS exam**: 2026-10-29 10:00–11:30, Room 204 [F1]
- ✉️ **Draft email to DBMS lab instructor**: asks to move the viva that clashes with IA-2 [F1][F6]
- ✅ **Before IA-2** …
```

Add the revised circular later and run `brief` again with all five files: the briefing now marks the old time as outdated and the clash disappears.
