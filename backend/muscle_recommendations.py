from __future__ import annotations

from typing import Any, Iterable, Optional

from pydantic import BaseModel, Field, model_validator

SUPPORTED_MUSCLES = {
    "chest", "back", "lats", "shoulders", "biceps", "triceps",
    "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
    "obliques", "lower_back",
}

ANTAGONISTS = {
    "chest": "back",
    "back": "chest",
    "lats": "chest",
    "shoulders": "lats",
    "biceps": "triceps",
    "triceps": "biceps",
    "forearms": "biceps",
    "quads": "hamstrings",
    "hamstrings": "quads",
    "glutes": "quads",
    "calves": "quads",
    "abs": "lower_back",
    "obliques": "lower_back",
    "lower_back": "abs",
}

LEVEL_RANK = {"beginner": 0, "intermediate": 1, "advanced": 2}


def _ex(
    slug: str,
    name: str,
    equipment: str,
    difficulty: str,
    primary: str,
    secondary: tuple[str, ...] = (),
    instructions: str = "",
    category: str = "strength",
    video_url: str | None = None,
    video_poster_url: str | None = None,
    video_duration_sec: int | None = None,
) -> dict[str, Any]:
    return {
        "slug": slug,
        "name": name,
        "category": category,
        "equipment": equipment,
        "difficulty": difficulty,
        "primary_muscle_slug": primary,
        "secondary_muscle_slugs": list(secondary),
        "instructions": instructions,
        "video_url": video_url,
        "video_poster_url": video_poster_url,
        "video_duration_sec": video_duration_sec,
    }


EXERCISE_LIBRARY: list[dict[str, Any]] = [
    _ex("barbell-bench-press", "Barbell Bench Press", "barbell", "intermediate", "chest", ("triceps", "shoulders"), "Lie on bench, lower bar to chest, press up."),
    _ex("incline-bench-press", "Incline Bench Press", "barbell", "intermediate", "chest", ("triceps", "shoulders"), "Set bench to 30 deg, press bar from upper chest."),
    _ex("decline-bench-press", "Decline Bench Press", "barbell", "intermediate", "chest", ("triceps", "shoulders"), "Decline bench, press bar from lower chest."),
    _ex("dumbbell-bench-press", "Dumbbell Bench Press", "dumbbell", "beginner", "chest", ("triceps", "shoulders"), "Press dumbbells from chest to lockout."),
    _ex("incline-dumbbell-press", "Incline Dumbbell Press", "dumbbell", "beginner", "chest", ("shoulders", "triceps"), "Press dumbbells on a 30-degree bench."),
    _ex("dumbbell-fly", "Dumbbell Fly", "dumbbell", "beginner", "chest", ("shoulders",), "Arc dumbbells with slight elbow bend."),
    _ex("cable-crossover", "Cable Crossover", "machine", "beginner", "chest", ("shoulders",), "Sweep cables together in front of the chest."),
    _ex("pec-deck", "Pec Deck", "machine", "beginner", "chest", (), "Bring machine arms together, squeeze chest."),
    _ex("chest-press-machine", "Chest Press Machine", "machine", "beginner", "chest", ("triceps", "shoulders"), "Press handles forward, control the return."),
    _ex("push-up", "Push Up", "bodyweight", "beginner", "chest", ("triceps", "shoulders"), "Lower chest to floor, press up."),
    _ex("dips", "Dips", "bodyweight", "intermediate", "triceps", ("chest", "shoulders"), "Lower until shoulders below elbows, press up."),
    _ex("close-grip-bench-press", "Close-Grip Bench Press", "barbell", "intermediate", "triceps", ("chest", "shoulders"), "Narrow grip bench press, elbows tucked."),
    _ex("tricep-pushdown", "Tricep Pushdown", "machine", "beginner", "triceps", (), "Push rope/bar down, keep elbows fixed."),
    _ex("skull-crusher", "Skull Crusher", "barbell", "intermediate", "triceps", (), "Lower bar to forehead, extend triceps."),
    _ex("overhead-triceps-extension", "Overhead Triceps Extension", "dumbbell", "beginner", "triceps", (), "Lower dumbbell behind head, extend."),
    _ex("tricep-kickback", "Tricep Kickback", "dumbbell", "beginner", "triceps", (), "Hinge, extend elbow until arm is straight."),
    _ex("bench-dips", "Bench Dips", "bodyweight", "beginner", "triceps", ("chest", "shoulders"), "Hands on bench, lower hips, press up."),
    _ex("diamond-push-up", "Diamond Push Up", "bodyweight", "intermediate", "triceps", ("chest",), "Hands form a diamond, press up."),
    _ex("pull-up", "Pull Up", "bodyweight", "intermediate", "lats", ("biceps", "back"), "Pull chin above bar, control descent."),
    _ex("chin-up", "Chin Up", "bodyweight", "intermediate", "biceps", ("lats", "back"), "Supinated grip, pull chin above bar."),
    _ex("lat-pulldown", "Lat Pulldown", "machine", "beginner", "lats", ("biceps", "back"), "Pull bar to upper chest, squeeze lats."),
    _ex("straight-arm-pulldown", "Straight-Arm Pulldown", "machine", "beginner", "lats", ("chest",), "Keep arms long, pull bar to hips."),
    _ex("one-arm-dumbbell-row", "One-Arm Dumbbell Row", "dumbbell", "beginner", "lats", ("back", "biceps"), "Row dumbbell to hip, squeeze lat."),
    _ex("assisted-pull-up", "Assisted Pull Up", "machine", "beginner", "lats", ("biceps",), "Use assist, pull chin over bar."),
    _ex("bent-over-row", "Bent Over Barbell Row", "barbell", "intermediate", "back", ("lats", "biceps"), "Hinge hips, row bar to lower ribs."),
    _ex("seated-cable-row", "Seated Cable Row", "machine", "beginner", "back", ("lats", "biceps"), "Row handle to abdomen, squeeze shoulder blades."),
    _ex("t-bar-row", "T-Bar Row", "barbell", "intermediate", "back", ("lats", "biceps"), "Row the landmine to the chest."),
    _ex("chest-supported-row", "Chest-Supported Row", "dumbbell", "beginner", "back", ("lats", "biceps"), "Chest on bench, row dumbbells."),
    _ex("inverted-row", "Inverted Row", "bodyweight", "beginner", "back", ("biceps", "lats"), "Hang under a bar, pull chest up."),
    _ex("deadlift", "Deadlift", "barbell", "advanced", "back", ("hamstrings", "glutes", "lower_back"), "Hinge, grip bar, drive floor away, lock out."),
    _ex("barbell-shrug", "Barbell Shrug", "barbell", "beginner", "back", ("shoulders",), "Elevate shoulders, pause, lower slow."),
    _ex("overhead-press", "Overhead Press", "barbell", "intermediate", "shoulders", ("triceps",), "Press bar overhead from front rack."),
    _ex("dumbbell-shoulder-press", "Dumbbell Shoulder Press", "dumbbell", "beginner", "shoulders", ("triceps",), "Press dumbbells overhead from shoulders."),
    _ex("arnold-press", "Arnold Press", "dumbbell", "intermediate", "shoulders", ("triceps",), "Rotate palms as you press overhead."),
    _ex("lateral-raise", "Lateral Raise", "dumbbell", "beginner", "shoulders", (), "Raise arms out to shoulder height."),
    _ex("front-raise", "Front Raise", "dumbbell", "beginner", "shoulders", ("chest",), "Raise dumbbells to eye level."),
    _ex("rear-delt-fly", "Rear Delt Fly", "dumbbell", "beginner", "shoulders", ("back",), "Hinge, raise arms out to the sides."),
    _ex("face-pull", "Face Pull", "machine", "beginner", "shoulders", ("back",), "Pull rope to face, external rotation."),
    _ex("cable-lateral-raise", "Cable Lateral Raise", "machine", "beginner", "shoulders", (), "Raise cable to shoulder height."),
    _ex("upright-row", "Upright Row", "barbell", "intermediate", "shoulders", ("biceps",), "Pull bar to lower chest, elbows high."),
    _ex("barbell-curl", "Barbell Curl", "barbell", "beginner", "biceps", ("forearms",), "Curl bar with elbows pinned."),
    _ex("dumbbell-curl", "Dumbbell Curl", "dumbbell", "beginner", "biceps", ("forearms",), "Alternate arms, supinate at top."),
    _ex("hammer-curl", "Hammer Curl", "dumbbell", "beginner", "biceps", ("forearms",), "Neutral grip curl for brachialis."),
    _ex("preacher-curl", "Preacher Curl", "barbell", "beginner", "biceps", (), "Curl on preacher pad, full stretch."),
    _ex("concentration-curl", "Concentration Curl", "dumbbell", "beginner", "biceps", (), "Elbow on inner thigh, curl to shoulder."),
    _ex("incline-dumbbell-curl", "Incline Dumbbell Curl", "dumbbell", "beginner", "biceps", (), "Incline bench, curl from a stretch."),
    _ex("cable-curl", "Cable Curl", "machine", "beginner", "biceps", ("forearms",), "Curl the cable with elbows tight."),
    _ex("wrist-curl", "Wrist Curl", "dumbbell", "beginner", "forearms", (), "Small ROM curl for forearms."),
    _ex("reverse-wrist-curl", "Reverse Wrist Curl", "dumbbell", "beginner", "forearms", (), "Palms down, extend the wrists."),
    _ex("reverse-curl", "Reverse Curl", "barbell", "beginner", "forearms", ("biceps",), "Pronated grip curl."),
    _ex("farmer-carry", "Farmer Carry", "dumbbell", "beginner", "forearms", ("abs", "back"), "Walk tall with heavy dumbbells."),
    _ex("plate-pinch", "Plate Pinch Hold", "bodyweight", "beginner", "forearms", (), "Pinch plates, hold for time."),
    _ex("back-squat", "Back Squat", "barbell", "intermediate", "quads", ("glutes", "hamstrings"), "Bar on upper back, squat below parallel."),
    _ex("front-squat", "Front Squat", "barbell", "advanced", "quads", ("glutes", "abs"), "Bar in front rack, squat upright."),
    _ex("goblet-squat", "Goblet Squat", "dumbbell", "beginner", "quads", ("glutes",), "Hold dumbbell at chest, squat."),
    _ex("hack-squat", "Hack Squat", "machine", "intermediate", "quads", ("glutes",), "Machine squat, knees track over toes."),
    _ex("leg-press", "Leg Press", "machine", "beginner", "quads", ("glutes", "hamstrings"), "Press platform, control descent."),
    _ex("lunge", "Walking Lunge", "dumbbell", "beginner", "quads", ("glutes",), "Alternate legs, knee tracks over toe."),
    _ex("bulgarian-split-squat", "Bulgarian Split Squat", "dumbbell", "intermediate", "quads", ("glutes",), "Rear foot elevated, drop back knee."),
    _ex("step-up", "Step Up", "dumbbell", "beginner", "quads", ("glutes",), "Step onto a box, drive through the heel."),
    _ex("leg-extension", "Leg Extension", "machine", "beginner", "quads", (), "Extend knees to lock out."),
    _ex("sissy-squat", "Sissy Squat", "bodyweight", "intermediate", "quads", (), "Lean back, knees forward, stay tall."),
    _ex("box-jump", "Box Jump", "bodyweight", "intermediate", "quads", ("calves", "glutes"), "Explode up onto box, step down.", "plyo"),
    _ex("romanian-deadlift", "Romanian Deadlift", "barbell", "intermediate", "hamstrings", ("glutes", "lower_back"), "Hinge with soft knees, feel hamstring stretch."),
    _ex("stiff-leg-deadlift", "Stiff-Leg Deadlift", "barbell", "intermediate", "hamstrings", ("lower_back", "glutes"), "Minimal knee bend, hinge to mid-shin."),
    _ex("leg-curl", "Leg Curl", "machine", "beginner", "hamstrings", (), "Curl heels to glutes."),
    _ex("nordic-curl", "Nordic Curl", "bodyweight", "advanced", "hamstrings", (), "Lower slowly from kneeling, pull back."),
    _ex("single-leg-rdl", "Single-Leg RDL", "dumbbell", "intermediate", "hamstrings", ("glutes",), "Hinge on one leg, dumbbell to mid-shin."),
    _ex("glute-ham-raise", "Glute Ham Raise", "bodyweight", "advanced", "hamstrings", ("glutes",), "From GHD, lower then curl back."),
    _ex("hip-thrust", "Hip Thrust", "barbell", "intermediate", "glutes", ("hamstrings",), "Drive hips up, squeeze glutes at top."),
    _ex("glute-bridge", "Glute Bridge", "bodyweight", "beginner", "glutes", ("hamstrings",), "Bridge hips off floor."),
    _ex("cable-kickback", "Cable Kickback", "machine", "beginner", "glutes", (), "Kick heel back, squeeze glute."),
    _ex("sumo-deadlift", "Sumo Deadlift", "barbell", "intermediate", "glutes", ("quads", "back"), "Wide stance, drive the floor apart."),
    _ex("reverse-lunge", "Reverse Lunge", "dumbbell", "beginner", "glutes", ("quads",), "Step back, drop the rear knee."),
    _ex("frog-pump", "Frog Pump", "bodyweight", "beginner", "glutes", (), "Soles together, thrust hips up."),
    _ex("kettlebell-swing", "Kettlebell Swing", "kettlebell", "intermediate", "glutes", ("hamstrings", "abs"), "Hip hinge, snap hips to swing to eye level.", "plyo"),
    _ex("standing-calf-raise", "Standing Calf Raise", "machine", "beginner", "calves", (), "Full stretch and full extension."),
    _ex("seated-calf-raise", "Seated Calf Raise", "machine", "beginner", "calves", (), "Bent-knee variation for soleus."),
    _ex("single-leg-calf-raise", "Single-Leg Calf Raise", "bodyweight", "beginner", "calves", (), "One-leg raise on a step."),
    _ex("donkey-calf-raise", "Donkey Calf Raise", "machine", "beginner", "calves", (), "Hinge at hips, raise the heels."),
    _ex("crunch", "Crunch", "bodyweight", "beginner", "abs", (), "Curl shoulders off floor."),
    _ex("sit-up", "Sit Up", "bodyweight", "beginner", "abs", (), "Sit all the way up, control down."),
    _ex("hanging-leg-raise", "Hanging Leg Raise", "bodyweight", "intermediate", "abs", ("obliques",), "Raise legs while hanging."),
    _ex("plank", "Plank", "bodyweight", "beginner", "abs", ("shoulders",), "Hold rigid position on forearms."),
    _ex("ab-wheel-rollout", "Ab Wheel Rollout", "bodyweight", "intermediate", "abs", ("shoulders", "lower_back"), "Roll out, keep ribs down, return."),
    _ex("cable-crunch", "Cable Crunch", "machine", "beginner", "abs", (), "Kneel, crunch the cable to the hips."),
    _ex("dead-bug", "Dead Bug", "bodyweight", "beginner", "abs", (), "Opposite arm and leg, keep back flat."),
    _ex("bicycle-crunch", "Bicycle Crunch", "bodyweight", "beginner", "abs", ("obliques",), "Elbow to opposite knee, slow tempo."),
    _ex("russian-twist", "Russian Twist", "bodyweight", "beginner", "obliques", ("abs",), "Rotate torso side to side, feet up."),
    _ex("side-plank", "Side Plank", "bodyweight", "beginner", "obliques", ("abs",), "Hold side position on forearm."),
    _ex("cable-woodchop", "Cable Woodchop", "machine", "beginner", "obliques", ("abs",), "Chop high to low across the body."),
    _ex("pallof-press", "Pallof Press", "machine", "beginner", "obliques", ("abs",), "Press cable out, resist rotation."),
    _ex("hanging-windshield-wiper", "Hanging Windshield Wiper", "bodyweight", "advanced", "obliques", ("abs",), "Hang, sweep legs side to side."),
    _ex("back-extension", "Back Extension", "bodyweight", "beginner", "lower_back", ("glutes",), "Hyperextend at hip on GHD."),
    _ex("good-morning", "Good Morning", "barbell", "intermediate", "lower_back", ("hamstrings", "glutes"), "Hinge with bar on upper back."),
    _ex("bird-dog", "Bird Dog", "bodyweight", "beginner", "lower_back", ("abs", "glutes"), "Opposite arm and leg, stay still."),
    _ex("superman", "Superman", "bodyweight", "beginner", "lower_back", ("glutes",), "Lift chest and legs off the floor."),
    _ex("reverse-hyper", "Reverse Hyper", "machine", "intermediate", "lower_back", ("glutes", "hamstrings"), "Lift legs behind you, squeeze."),
    _ex("landmine-press", "Landmine Press", "barbell", "beginner", "chest", ("shoulders", "triceps"), "Press the landmine up and in from shoulder height."),
    _ex("floor-press", "Floor Press", "barbell", "intermediate", "chest", ("triceps",), "Press from the floor, triceps take over at the bottom."),
    _ex("squeeze-press", "Squeeze Press", "dumbbell", "beginner", "chest", ("triceps",), "Press dumbbells while squeezing them together."),
    _ex("wide-push-up", "Wide Push Up", "bodyweight", "beginner", "chest", ("shoulders",), "Hands outside shoulder width, lower and press."),
    _ex("decline-push-up", "Decline Push Up", "bodyweight", "intermediate", "chest", ("shoulders", "triceps"), "Feet elevated, lower chest to the floor."),
    _ex("incline-push-up", "Incline Push Up", "bodyweight", "beginner", "chest", ("triceps",), "Hands on a bench, easier push-up angle."),
    _ex("machine-fly", "Machine Fly", "machine", "beginner", "chest", (), "Bring pads together in a wide arc."),
    _ex("low-cable-fly", "Low Cable Fly", "machine", "beginner", "chest", ("shoulders",), "Sweep cables upward to upper chest."),
    _ex("jm-press", "JM Press", "barbell", "advanced", "triceps", ("chest",), "Hybrid skull crusher and close-grip press."),
    _ex("cable-overhead-extension", "Cable Overhead Extension", "machine", "beginner", "triceps", (), "Face away, extend the cable overhead."),
    _ex("lying-dumbbell-extension", "Lying Dumbbell Extension", "dumbbell", "beginner", "triceps", (), "Lower dumbbells beside the head, extend."),
    _ex("machine-tricep-dip", "Machine Tricep Dip", "machine", "beginner", "triceps", ("chest",), "Press the dip handles down to lockout."),
    _ex("single-arm-pushdown", "Single-Arm Pushdown", "machine", "beginner", "triceps", (), "One-arm cable pushdown, elbow pinned."),
    _ex("wide-grip-pulldown", "Wide-Grip Pulldown", "machine", "beginner", "lats", ("biceps", "back"), "Wide grip, pull bar to the upper chest."),
    _ex("close-grip-pulldown", "Close-Grip Pulldown", "machine", "beginner", "lats", ("biceps",), "Neutral close grip, pull to the sternum."),
    _ex("dumbbell-pullover", "Dumbbell Pullover", "dumbbell", "beginner", "lats", ("chest",), "Lower dumbbell behind the head, pull over."),
    _ex("meadow-row", "Meadow Row", "barbell", "intermediate", "lats", ("back", "biceps"), "Landmine row from a staggered stance."),
    _ex("kneeling-lat-pulldown", "Kneeling Straight-Arm Pulldown", "machine", "beginner", "lats", (), "Kneel, keep arms long, pull to hips."),
    _ex("rack-chin", "Rack Chin-Up", "bodyweight", "intermediate", "lats", ("biceps",), "Feet on a bench, pull chest to the bar."),
    _ex("pendlay-row", "Pendlay Row", "barbell", "intermediate", "back", ("lats", "biceps"), "Each rep starts from a dead stop on the floor."),
    _ex("seal-row", "Seal Row", "barbell", "intermediate", "back", ("lats", "biceps"), "Chest-supported row on a high bench."),
    _ex("yates-row", "Yates Row", "barbell", "intermediate", "back", ("biceps", "lats"), "More upright row to the lower abs."),
    _ex("trap-bar-deadlift", "Trap-Bar Deadlift", "barbell", "intermediate", "back", ("quads", "glutes"), "Stand inside the trap bar, stand tall."),
    _ex("reverse-grip-row", "Reverse-Grip Barbell Row", "barbell", "intermediate", "back", ("biceps", "lats"), "Supinated grip, row to the waist."),
    _ex("cable-shrug", "Cable Shrug", "machine", "beginner", "back", ("shoulders",), "Shrug against a low cable."),
    _ex("machine-shoulder-press", "Machine Shoulder Press", "machine", "beginner", "shoulders", ("triceps",), "Press the machine handles overhead."),
    _ex("pike-push-up", "Pike Push Up", "bodyweight", "intermediate", "shoulders", ("triceps",), "Hips high, lower the head toward the floor."),
    _ex("cable-rear-delt-fly", "Cable Rear Delt Fly", "machine", "beginner", "shoulders", ("back",), "Cross cables, open the arms wide."),
    _ex("machine-lateral-raise", "Machine Lateral Raise", "machine", "beginner", "shoulders", (), "Raise the pads to shoulder height."),
    _ex("landmine-lateral-raise", "Landmine Lateral Raise", "barbell", "beginner", "shoulders", (), "Sweep the landmine out to the side."),
    _ex("scapular-raise", "Scapular Raise", "dumbbell", "beginner", "shoulders", (), "Raise thumbs up in a Y pattern."),
    _ex("ez-bar-curl", "EZ-Bar Curl", "barbell", "beginner", "biceps", ("forearms",), "Curl the EZ bar with elbows pinned."),
    _ex("spider-curl", "Spider Curl", "dumbbell", "beginner", "biceps", (), "Chest on incline bench, curl from a hang."),
    _ex("bayesian-curl", "Bayesian Cable Curl", "machine", "beginner", "biceps", (), "Face away from the cable, curl from a stretch."),
    _ex("drag-curl", "Drag Curl", "barbell", "beginner", "biceps", (), "Drag the bar up the torso, elbows back."),
    _ex("cable-hammer-curl", "Cable Hammer Curl", "machine", "beginner", "biceps", ("forearms",), "Rope curl with a neutral grip."),
    _ex("zottman-curl", "Zottman Curl", "dumbbell", "intermediate", "biceps", ("forearms",), "Supinate up, pronate down."),
    _ex("dead-hang", "Dead Hang", "bodyweight", "beginner", "forearms", ("lats",), "Hang from a bar, squeeze the bar hard."),
    _ex("towel-hang", "Towel Hang", "bodyweight", "intermediate", "forearms", (), "Hang from towels draped over a bar."),
    _ex("behind-back-wrist-curl", "Behind-Back Wrist Curl", "barbell", "beginner", "forearms", (), "Bar behind the body, curl the wrists."),
    _ex("reverse-wrist-roller", "Wrist Roller", "bodyweight", "beginner", "forearms", (), "Roll the weight up and down with the wrists."),
    _ex("pendulum-squat", "Pendulum Squat", "machine", "intermediate", "quads", ("glutes",), "Machine squat with a long range at the bottom."),
    _ex("belt-squat", "Belt Squat", "machine", "intermediate", "quads", ("glutes",), "Load on a belt, squat without spinal load."),
    _ex("split-squat", "Split Squat", "dumbbell", "beginner", "quads", ("glutes",), "Static lunge, drop the back knee."),
    _ex("heel-elevated-squat", "Heel-Elevated Squat", "dumbbell", "beginner", "quads", (), "Heels on plates, stay upright, sit down."),
    _ex("pistol-squat", "Pistol Squat", "bodyweight", "advanced", "quads", ("glutes",), "Single-leg squat to full depth."),
    _ex("leg-press-narrow", "Narrow-Stance Leg Press", "machine", "beginner", "quads", (), "Feet low and close, press through the toes."),
    _ex("seated-leg-curl", "Seated Leg Curl", "machine", "beginner", "hamstrings", (), "Curl the pad under the seat."),
    _ex("lying-leg-curl", "Lying Leg Curl", "machine", "beginner", "hamstrings", (), "Lie face down, curl heels to glutes."),
    _ex("swiss-ball-leg-curl", "Swiss-Ball Leg Curl", "bodyweight", "intermediate", "hamstrings", ("glutes",), "Hips up, curl the ball toward you."),
    _ex("sliding-leg-curl", "Sliding Leg Curl", "bodyweight", "intermediate", "hamstrings", ("glutes",), "Heels on sliders, curl in with hips high."),
    _ex("dumbbell-rdl", "Dumbbell RDL", "dumbbell", "beginner", "hamstrings", ("glutes", "lower_back"), "Hinge with dumbbells along the thighs."),
    _ex("hip-abduction", "Hip Abduction", "machine", "beginner", "glutes", (), "Open the pads against the machine."),
    _ex("clamshell", "Clamshell", "bodyweight", "beginner", "glutes", (), "Side-lying, open the top knee."),
    _ex("cable-pull-through", "Cable Pull-Through", "machine", "beginner", "glutes", ("hamstrings",), "Straddle the cable, snap the hips through."),
    _ex("curtsy-lunge", "Curtsy Lunge", "dumbbell", "beginner", "glutes", ("quads",), "Step the back leg behind and across."),
    _ex("smith-hip-thrust", "Smith Machine Hip Thrust", "machine", "beginner", "glutes", ("hamstrings",), "Thrust the Smith bar with the back on a bench."),
    _ex("leg-press-calf-raise", "Leg-Press Calf Raise", "machine", "beginner", "calves", (), "Balls of feet on the platform, press the toes."),
    _ex("smith-calf-raise", "Smith Calf Raise", "machine", "beginner", "calves", (), "Smith bar on the traps, raise the heels."),
    _ex("seated-dumbbell-calf-raise", "Seated Dumbbell Calf Raise", "dumbbell", "beginner", "calves", (), "Dumbbells on the knees, raise the heels."),
    _ex("jump-calf-raise", "Jump Calf Raise", "bodyweight", "intermediate", "calves", ("quads",), "Small hops from the balls of the feet.", "plyo"),
    _ex("tib-raise", "Tibialis Raise", "bodyweight", "beginner", "calves", (), "Heels planted, lift the toes toward the shins."),
    _ex("hanging-knee-raise", "Hanging Knee Raise", "bodyweight", "beginner", "abs", ("obliques",), "Hang, lift the knees to the chest."),
    _ex("v-up", "V-Up", "bodyweight", "intermediate", "abs", (), "Reach hands to feet, body in a V."),
    _ex("hollow-hold", "Hollow Hold", "bodyweight", "beginner", "abs", (), "Lower back pressed down, limbs long."),
    _ex("toe-touch", "Toe Touch", "bodyweight", "beginner", "abs", (), "Lie down, reach toward the toes."),
    _ex("decline-sit-up", "Decline Sit-Up", "bodyweight", "intermediate", "abs", (), "Sit up on a decline bench."),
    _ex("dragon-flag", "Dragon Flag", "bodyweight", "advanced", "abs", ("lower_back",), "Keep the body rigid, lower and lift from the shoulders."),
    _ex("side-crunch", "Side Crunch", "bodyweight", "beginner", "obliques", ("abs",), "Crunch sideways toward the hip."),
    _ex("suitcase-carry", "Suitcase Carry", "dumbbell", "beginner", "obliques", ("abs", "forearms"), "Walk with a load in one hand only."),
    _ex("landmine-rotation", "Landmine Rotation", "barbell", "beginner", "obliques", ("abs",), "Rotate the landmine from hip to hip."),
    _ex("heel-tap", "Heel Tap", "bodyweight", "beginner", "obliques", ("abs",), "Crunch side to side, tap each heel."),
    _ex("copenhagen-plank", "Copenhagen Plank", "bodyweight", "advanced", "obliques", ("abs",), "Side plank with the top leg on a bench."),
    _ex("rack-pull", "Rack Pull", "barbell", "intermediate", "lower_back", ("back", "glutes"), "Deadlift from pins just below the knee."),
    _ex("kettlebell-deadlift", "Kettlebell Deadlift", "kettlebell", "beginner", "lower_back", ("glutes", "hamstrings"), "Hinge, pick up the kettlebell, stand tall."),
    _ex("seated-good-morning", "Seated Good Morning", "barbell", "intermediate", "lower_back", ("hamstrings",), "Sit, hinge the torso forward, stay braced."),
    _ex("band-hip-hinge", "Band Hip Hinge", "bodyweight", "beginner", "lower_back", ("glutes",), "Push the hips back against a band."),
    _ex("hyperextension-hold", "Hyperextension Hold", "bodyweight", "beginner", "lower_back", ("glutes",), "Hold the top of a back extension."),
    _ex("ski-erg", "Ski Erg", "machine", "beginner", "cardio", ("lats", "abs"), "Drive the handles down, hinge slightly.", "cardio"),
    _ex("battle-rope", "Battle Rope Waves", "bodyweight", "beginner", "cardio", ("shoulders", "abs"), "Alternate waves as fast as you can.", "plyo"),
    _ex("jump-squat", "Jump Squat", "bodyweight", "intermediate", "cardio", ("quads", "glutes"), "Squat then jump, land soft.", "plyo"),
    _ex("high-knees", "High Knees", "bodyweight", "beginner", "cardio", ("abs", "quads"), "Run in place, knees to hip height.", "plyo"),
    _ex("burpee", "Burpee", "bodyweight", "beginner", "cardio", ("chest", "quads"), "Down, plank, jump up.", "plyo"),
    _ex("mountain-climber", "Mountain Climber", "bodyweight", "beginner", "cardio", ("abs",), "Drive knees in from plank.", "plyo"),
    _ex("jump-rope", "Jump Rope", "bodyweight", "beginner", "cardio", ("calves",), "Steady bounce, wrist rotation.", "cardio"),
    _ex("rowing-erg", "Rowing Erg", "machine", "beginner", "cardio", ("back", "lats"), "Legs, hips, arms; reverse in return.", "cardio"),
    _ex("run", "Run", "bodyweight", "beginner", "cardio", ("quads", "calves"), "Steady effort run.", "cardio"),
    _ex("bike-erg", "Bike Erg", "machine", "beginner", "cardio", ("quads",), "Pedal steady, adjust resistance.", "cardio"),
    _ex("assault-bike", "Assault Bike Sprint", "machine", "intermediate", "cardio", ("shoulders", "quads"), "All-out effort intervals.", "cardio"),
    _ex("smith-bench-press", "Smith Machine Bench Press", "machine", "beginner", "chest", ("triceps", "shoulders"), "Press the Smith bar from the chest on a guided path."),
    _ex("cable-chest-press", "Cable Chest Press", "machine", "beginner", "chest", ("triceps", "shoulders"), "Press both cables forward from chest height."),
    _ex("hex-press", "Hex Press", "dumbbell", "beginner", "chest", ("triceps",), "Press dumbbells while keeping the inner plates touching."),
    _ex("around-the-world", "Around the World", "dumbbell", "beginner", "chest", ("shoulders",), "Sweep dumbbells from hips out and overhead in a wide arc."),
    _ex("weighted-dip", "Weighted Dip", "bodyweight", "advanced", "triceps", ("chest", "shoulders"), "Dip with added load, stay slightly forward."),
    _ex("tate-press", "Tate Press", "dumbbell", "intermediate", "triceps", (), "Elbows out, lower dumbbells to the chest, extend."),
    _ex("neutral-grip-pull-up", "Neutral-Grip Pull Up", "bodyweight", "intermediate", "lats", ("biceps",), "Palms facing, pull the chest to the handles."),
    _ex("single-arm-lat-pulldown", "Single-Arm Lat Pulldown", "machine", "beginner", "lats", ("biceps",), "Pull one handle to the ribcage, pause, return."),
    _ex("machine-row", "Machine Row", "machine", "beginner", "back", ("lats", "biceps"), "Chest on the pad, row the handles to the hips."),
    _ex("snatch-grip-row", "Snatch-Grip Row", "barbell", "intermediate", "back", ("lats", "shoulders"), "Wide grip row to the lower chest."),
    _ex("cuban-press", "Cuban Press", "dumbbell", "intermediate", "shoulders", ("back",), "Upright row, external rotate, then press."),
    _ex("bus-driver", "Bus Driver", "bodyweight", "beginner", "shoulders", (), "Hold a plate at eye level and rotate like a steering wheel."),
    _ex("incline-hammer-curl", "Incline Hammer Curl", "dumbbell", "beginner", "biceps", ("forearms",), "Incline bench, neutral grip curls from a stretch."),
    _ex("waiter-curl", "Waiter Curl", "dumbbell", "beginner", "biceps", (), "Palm under a dumbbell, curl it like a tray."),
    _ex("fat-grip-hold", "Fat-Grip Hold", "dumbbell", "beginner", "forearms", (), "Hold thick handles or fat grips for time."),
    _ex("smith-squat", "Smith Machine Squat", "machine", "beginner", "quads", ("glutes",), "Guided bar squat, stay upright, sit between the heels."),
    _ex("wall-sit", "Wall Sit", "bodyweight", "beginner", "quads", ("glutes",), "Back on the wall, thighs parallel, hold."),
    _ex("deficit-rdl", "Deficit RDL", "barbell", "advanced", "hamstrings", ("glutes", "lower_back"), "Stand on a plate, hinge deeper than a normal RDL."),
    _ex("45-degree-hyper", "45-Degree Hyper", "machine", "beginner", "glutes", ("hamstrings", "lower_back"), "Pad on the hips, lift the torso by squeezing glutes."),
    _ex("standing-hip-abduction", "Standing Cable Abduction", "machine", "beginner", "glutes", (), "Kick the working leg out against a low cable."),
    _ex("donkey-kick", "Donkey Kick", "bodyweight", "beginner", "glutes", (), "On all fours, kick one heel to the ceiling."),
    _ex("band-calf-raise", "Band Calf Raise", "bodyweight", "beginner", "calves", (), "Stand on a band, raise the heels against the tension."),
    _ex("toes-walk", "Toes Walk", "bodyweight", "beginner", "calves", (), "Walk forward on the balls of the feet."),
    _ex("weighted-crunch", "Weighted Crunch", "dumbbell", "beginner", "abs", (), "Hold a plate on the chest, curl the ribs down."),
    _ex("vacuum", "Stomach Vacuum", "bodyweight", "beginner", "abs", (), "Exhale, pull the navel in, hold the brace."),
    _ex("hanging-oblique-raise", "Hanging Oblique Raise", "bodyweight", "intermediate", "obliques", ("abs",), "Hang, lift the knees toward one elbow, then the other."),
    _ex("suitcase-deadlift", "Suitcase Deadlift", "dumbbell", "intermediate", "lower_back", ("obliques", "glutes"), "Deadlift a load on one side, stay tall, do not lean."),
    _ex("stair-climber", "Stair Climber", "machine", "beginner", "cardio", ("quads", "glutes"), "Even steps, light hand support.", "cardio"),
    _ex("elliptical", "Elliptical", "machine", "beginner", "cardio", ("quads",), "Quiet stride, push and pull the handles.", "cardio"),
    _ex("swim", "Swim", "bodyweight", "beginner", "cardio", ("lats", "shoulders"), "Continuous laps, steady breathing.", "cardio"),
]


def merge_exercise_catalog(db_items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    by_slug = {item["slug"]: dict(item) for item in EXERCISE_LIBRARY}
    for item in db_items:
        slug = item.get("slug")
        if not slug:
            continue
        base = by_slug.get(slug, {})
        merged = {**base, **item}
        if not merged.get("secondary_muscle_slugs"):
            merged["secondary_muscle_slugs"] = base.get("secondary_muscle_slugs") or []
        if not merged.get("name") and base.get("name"):
            merged["name"] = base["name"]
        by_slug[slug] = merged
    return list(by_slug.values())


def build_recommendations(
    catalog: Iterable[dict[str, Any]],
    muscle_slug: str,
    equipment: Optional[list[str]] = None,
    level: Optional[str] = None,
) -> dict[str, Any]:
    if muscle_slug not in SUPPORTED_MUSCLES:
        raise ValueError(f"Unsupported muscle: {muscle_slug}")

    entries = list(catalog)
    allowed_equipment = {item.lower() for item in equipment or []}
    max_rank = LEVEL_RANK.get(level, LEVEL_RANK["advanced"])

    def eligible(item: dict[str, Any]) -> bool:
        item_equipment = (item.get("equipment") or "bodyweight").lower()
        item_level = LEVEL_RANK.get(item.get("difficulty", "beginner"), 0)
        return (
            (not allowed_equipment or item_equipment in allowed_equipment)
            and item_level <= max_rank
        )

    filtered = [item for item in entries if eligible(item)]
    primary = [
        item for item in filtered
        if item.get("primary_muscle_slug") == muscle_slug
    ]
    secondary = [
        item for item in filtered
        if muscle_slug in (item.get("secondary_muscle_slugs") or [])
        and item.get("primary_muscle_slug") != muscle_slug
    ]
    antagonist_slug = ANTAGONISTS[muscle_slug]
    antagonist = [
        item for item in filtered
        if item.get("primary_muscle_slug") == antagonist_slug
    ]

    combined = primary + antagonist
    circuit_source = combined if len(combined) >= 3 else primary + secondary
    circuit_items = [
        {
            "exercise_slug": item["slug"],
            "name": item["name"],
            "sets": 3,
            "reps_min": 8,
            "reps_max": 12,
            "rest_sec": 60,
        }
        for item in circuit_source[:8]
    ]
    circuits = (
        [{"name": f"{muscle_slug.replace('_', ' ').title()} Builder", "items": circuit_items}]
        if len(circuit_items) >= 2
        else []
    )
    return {
        "muscle_slug": muscle_slug,
        "antagonist_slug": antagonist_slug,
        "primary": primary,
        "secondary": secondary,
        "combinations": (primary[:5] + antagonist[:4] + secondary[:4])[:12],
        "circuits": circuits,
    }


class AiCircuitItem(BaseModel):
    exercise_slug: str
    sets: int = Field(ge=1, le=6)
    reps_min: int = Field(ge=1, le=50)
    reps_max: int = Field(ge=1, le=50)
    rest_sec: int = Field(ge=15, le=300)

    @model_validator(mode="after")
    def reps_are_ordered(self):
        if self.reps_min > self.reps_max:
            raise ValueError("reps_min must not exceed reps_max")
        return self


class AiCircuit(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    rationale: str = Field(min_length=3, max_length=300)
    items: list[AiCircuitItem] = Field(min_length=2, max_length=5)


def validate_ai_circuit(data: Any, allowed_slugs: set[str]) -> AiCircuit:
    circuit = AiCircuit.model_validate(data)
    unknown = [
        item.exercise_slug
        for item in circuit.items
        if item.exercise_slug not in allowed_slugs
    ]
    if unknown:
        raise ValueError(f"unknown exercise slugs: {unknown}")
    return circuit


AI_CIRCUIT_SYSTEM = """You are a strength training coach. Generate a workout circuit as valid JSON only.

Requirements:
- Use ONLY exercise slugs from the provided catalog
- Include 2-5 exercises
- Sets: 1-6 per exercise
- Reps: 1-50 (min must not exceed max)
- Rest: 15-300 seconds
- Name: 3-80 characters
- Rationale: 3-300 characters explaining the selection
- NO medical claims or guarantees

Return ONLY valid JSON matching this exact structure:
{
  "name": "Circuit Name",
  "rationale": "Brief explanation",
  "items": [
    {
      "exercise_slug": "exact-catalog-slug",
      "sets": 3,
      "reps_min": 8,
      "reps_max": 12,
      "rest_sec": 60
    }
  ]
}"""
