#!/usr/bin/env python3
"""IronFlow exercise thumbnail generator: pose templates + equipment overlays + muscle highlights -> SVG/PNG/WebP."""
import csv, json, re, os, sys, io
BG, NEAR, FAR, ACC, ACC2, EQ, GROUND = "#141821", "#B3BCCD", "#667086", "#FF6A3D", "#FFB08F", "#D3DAE6", "#2A3040"
W = 10  # limb stroke on 100-unit canvas (readable at 40px)

# Pose: joints h n p k1 a1 k2 a2 e1 w1 e2 w2 ; side 1 = near. 'front' => both sides equal.
P = {
 "stand":      dict(h=(50,18),n=(50,30),p=(50,56),k1=(52,73),a1=(52,90),k2=(48,73),a2=(48,90),e1=(52,44),w1=(52,58),e2=(48,44),w2=(48,58)),
 "squat":      dict(h=(54,26),n=(50,37),p=(34,62),k1=(58,64),a1=(52,89),k2=(54,64),a2=(48,89),e1=(42,46),w1=(46,36),e2=(40,46),w2=(44,36)),
 "hinge":      dict(h=(77,36),n=(66,42),p=(40,52),k1=(46,70),a1=(44,89),k2=(43,70),a2=(41,89),e1=(66,55),w1=(66,68),e2=(63,55),w2=(63,68)),
 "lunge":      dict(h=(50,20),n=(50,32),p=(50,57),k1=(68,68),a1=(68,89),k2=(38,82),a2=(22,87),e1=(51,45),w1=(51,58),e2=(49,45),w2=(49,58)),
 "hpress":     dict(h=(19,55),n=(30,59),p=(60,59),k1=(78,60),a1=(82,89),k2=(76,61),a2=(78,89),e1=(33,45),w1=(31,31),e2=(29,45),w2=(28,31),props=["bench"]),
 "ipress":     dict(h=(28,38),n=(37,48),p=(56,68),k1=(73,66),a1=(75,89),k2=(71,67),a2=(71,89),e1=(41,35),w1=(39,21),e2=(37,35),w2=(35,21),props=["ibench"]),
 "ohpress":    dict(h=(48,22),n=(50,33),p=(50,58),k1=(52,74),a1=(52,90),k2=(48,74),a2=(48,90),e1=(55,20),w1=(56,7),e2=(52,20),w2=(53,7)),
 "row":        dict(h=(77,37),n=(66,43),p=(40,54),k1=(47,71),a1=(44,89),k2=(44,71),a2=(41,89),e1=(54,48),w1=(62,61),e2=(51,48),w2=(59,61)),
 "seatrow":    dict(h=(40,30),n=(40,41),p=(38,68),k1=(60,62),a1=(76,72),k2=(58,63),a2=(74,73),e1=(30,50),w1=(46,52),e2=(28,51),w2=(44,53),props=["seat"],anchor=(94,52)),
 "vpull":      dict(h=(50,27),n=(50,38),p=(50,63),k1=(49,77),a1=(40,86),k2=(47,77),a2=(38,86),e1=(58,25),w1=(53,9),e2=(55,25),w2=(50,9),props=["pullbar"]),
 "pulldown":   dict(h=(46,32),n=(46,43),p=(46,67),k1=(66,67),a1=(66,88),k2=(64,68),a2=(64,88),e1=(57,35),w1=(54,18),e2=(55,35),w2=(52,18),props=["seat"],anchor=(53,3)),
 "curl":       dict(h=(50,18),n=(50,30),p=(50,56),k1=(52,73),a1=(52,90),k2=(48,73),a2=(48,90),e1=(51,45),w1=(63,36),e2=(48,45),w2=(60,37)),
 "triext":     dict(h=(47,22),n=(50,33),p=(50,58),k1=(52,74),a1=(52,90),k2=(48,74),a2=(48,90),e1=(55,13),w1=(43,24),e2=(52,13),w2=(41,25)),
 "pushdown":   dict(h=(50,18),n=(50,30),p=(50,56),k1=(52,73),a1=(52,90),k2=(48,73),a2=(48,90),e1=(52,45),w1=(60,58),e2=(49,45),w2=(57,58),anchor=(64,4)),
 "latraise":   dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(44,73),a1=(43,90),k2=(56,73),a2=(57,90),e1=(37,32),w1=(22,31),e2=(63,32),w2=(78,31)),
 "fly":        dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(44,73),a1=(43,90),k2=(56,73),a2=(57,90),e1=(33,40),w1=(45,48),e2=(67,40),w2=(55,48),anchor=(8,8),anchor2=(92,8)),
 "frontall":   dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(45,73),a1=(44,90),k2=(55,73),a2=(56,90),e1=(41,43),w1=(39,56),e2=(59,43),w2=(61,56)),
 "abduct":     dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(45,73),a1=(44,90),k2=(62,70),a2=(72,84),e1=(41,43),w1=(39,56),e2=(59,43),w2=(61,56),anchor=(94,86)),
 "legpress":   dict(h=(15,47),n=(24,54),p=(42,72),k1=(54,52),a1=(72,46),k2=(52,54),a2=(70,48),e1=(32,66),w1=(40,72),e2=(30,67),w2=(38,73),props=["sled","rseat"]),
 "legext":     dict(h=(40,26),n=(40,38),p=(40,63),k1=(61,63),a1=(81,57),k2=(59,64),a2=(79,58),e1=(43,51),w1=(50,63),e2=(41,51),w2=(48,63),props=["seat","pad"]),
 "legcurl":    dict(h=(18,52),n=(29,58),p=(56,59),k1=(77,59),a1=(72,39),k2=(75,60),a2=(70,40),e1=(22,69),w1=(12,69),e2=(20,69),w2=(10,69),props=["bench"]),
 "calf":       dict(h=(50,14),n=(50,26),p=(50,52),k1=(52,69),a1=(52,83),k2=(48,69),a2=(48,83),e1=(52,40),w1=(52,54),e2=(48,40),w2=(48,54),props=["block"]),
 "plank":      dict(h=(19,51),n=(29,56),p=(57,63),k1=(73,68),a1=(89,73),k2=(71,68),a2=(87,73),e1=(29,75),w1=(40,75),e2=(27,75),w2=(38,75)),
 "pushup":     dict(h=(19,46),n=(29,52),p=(58,62),k1=(74,68),a1=(90,74),k2=(72,68),a2=(88,74),e1=(26,64),w1=(29,77),e2=(24,64),w2=(27,77)),
 "crunch":     dict(h=(34,59),n=(42,68),p=(58,82),k1=(70,62),a1=(85,81),k2=(68,63),a2=(83,81),e1=(48,58),w1=(38,57),e2=(46,59),w2=(37,58)),
 "legraise":   dict(h=(50,25),n=(50,36),p=(50,61),k1=(68,57),a1=(84,55),k2=(66,59),a2=(82,57),e1=(56,24),w1=(52,9),e2=(53,24),w2=(49,9),props=["pullbar"]),
 "thrust":     dict(h=(17,54),n=(27,58),p=(53,56),k1=(70,57),a1=(72,87),k2=(68,58),a2=(69,87),e1=(41,63),w1=(52,57),e2=(39,63),w2=(50,57),props=["lbench"]),
 "quadruped":  dict(h=(22,44),n=(32,50),p=(60,52),k1=(78,40),a1=(92,30),k2=(60,74),a2=(80,76),e1=(32,64),w1=(32,77),e2=(34,64),w2=(34,77)),
 "carry":      dict(h=(50,18),n=(50,30),p=(50,56),k1=(57,72),a1=(61,90),k2=(45,72),a2=(40,90),e1=(53,44),w1=(53,59),e2=(48,44),w2=(48,59)),
 "dip":        dict(h=(53,25),n=(50,36),p=(47,62),k1=(49,77),a1=(37,82),k2=(47,77),a2=(35,82),e1=(36,44),w1=(48,58),e2=(34,45),w2=(46,58),props=["dipbar"]),
 "jump":       dict(h=(50,17),n=(50,28),p=(50,51),k1=(47,64),a1=(53,76),k2=(54,63),a2=(49,77),e1=(57,18),w1=(61,7),e2=(43,18),w2=(39,7),props=["motion"]),
 "run":        dict(h=(57,19),n=(54,30),p=(48,55),k1=(63,65),a1=(58,82),k2=(40,71),a2=(29,80),e1=(61,41),w1=(69,33),e2=(45,42),w2=(38,51)),
 "rower":      dict(h=(27,45),n=(33,54),p=(42,78),k1=(60,74),a1=(77,80),k2=(58,75),a2=(75,81),e1=(29,66),w1=(42,64),e2=(27,67),w2=(40,65),props=["rail"]),
 "bike":       dict(h=(68,27),n=(60,35),p=(41,56),k1=(59,58),a1=(53,78),k2=(52,66),a2=(46,84),e1=(66,45),w1=(73,51),e2=(64,46),w2=(71,52),props=["bikeframe"]),
 "backext":   dict(h=(80,62),n=(70,56),p=(46,42),k1=(30,58),a1=(20,74),k2=(28,59),a2=(18,75),e1=(74,46),w1=(70,38),e2=(72,47),w2=(68,39),props=["hyperbench"]),
 "nordic":    dict(h=(74,40),n=(64,46),p=(40,62),k1=(26,80),a1=(8,82),k2=(24,81),a2=(6,83),e1=(70,58),w1=(76,66),e2=(68,59),w2=(74,67),props=["anklepad"]),
 "hollow":    dict(h=(18,58),n=(27,64),p=(52,76),k1=(70,68),a1=(88,60),k2=(68,69),a2=(86,61),e1=(18,70)if 0 else (16,58),w1=(6,52),e2=(15,59),w2=(5,53)),
 "deadbug":   dict(h=(16,76),n=(26,78),p=(54,78),k1=(60,58),a1=(78,58),k2=(72,72),a2=(90,78),e1=(28,62),w1=(30,46),e2=(22,66),w2=(14,58)),
 "rollout":   dict(h=(22,56),n=(32,60),p=(58,66),k1=(70,82),a1=(88,84),k2=(68,82),a2=(86,84),e1=(22,68),w1=(14,78),e2=(20,68),w2=(12,78),props=["wheel"]),
 "pallof":    dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(44,73),a1=(42,90),k2=(56,73),a2=(58,90),e1=(46,42),w1=(50,44),e2=(54,42),w2=(50,44),anchor=(6,44)),
 "wrist":     dict(h=(40,24),n=(40,36),p=(40,62),k1=(62,62),a1=(62,89),k2=(60,63),a2=(60,89),e1=(54,56),w1=(70,56),e2=(52,57),w2=(68,57),props=["seat"]),
 "grip":      dict(h=(50,18),n=(50,30),p=(50,56),k1=(52,73),a1=(52,90),k2=(48,73),a2=(48,90),e1=(53,44),w1=(54,59),e2=(48,44),w2=(48,59)),
 "elliptical":dict(h=(52,16),n=(50,27),p=(46,52),k1=(58,64),a1=(56,80),k2=(42,68),a2=(36,82),e1=(60,38),w1=(66,28),e2=(56,40),w2=(62,30),props=["ellip"]),
 "stair":     dict(h=(52,16),n=(50,27),p=(46,52),k1=(60,58),a1=(58,72),k2=(46,70),a2=(44,86),e1=(56,40),w1=(64,48),e2=(52,40),w2=(60,48),props=["steps"]),
 "ski":       dict(h=(62,28),n=(56,37),p=(40,56),k1=(48,72),a1=(44,90),k2=(46,72),a2=(42,90),e1=(62,52),w1=(58,66),e2=(60,52),w2=(56,66),anchor=(66,4),props=["skipost"]),
 "swim":      dict(h=(80,50),n=(70,52),p=(42,54),k1=(26,52),a1=(10,50),k2=(26,58),a2=(12,60),e1=(80,40),w1=(92,44),e2=(58,60),w2=(46,64),props=["water"]),
 "ropes":     dict(h=(50,26),n=(48,37),p=(38,60),k1=(56,68),a1=(54,89),k2=(52,69),a2=(50,89),e1=(56,48),w1=(66,52),e2=(54,49),w2=(64,53),props=["rope"]),
 "shrug":     dict(h=(50,22),n=(50,32),p=(50,57),k1=(52,74),a1=(52,90),k2=(48,74),a2=(48,90),e1=(52,45),w1=(52,59),e2=(48,45),w2=(48,59),props=["uparrows"]),
 "abductm":   dict(front=1,h=(50,22),n=(50,34),p=(50,58),k1=(36,66),a1=(32,86),k2=(64,66),a2=(68,86),e1=(42,46),w1=(42,58),e2=(58,46),w2=(58,58),props=["fseat","kneepads"]),
 "tibialis":  dict(h=(32,16),n=(34,27),p=(38,52),k1=(44,70),a1=(50,86),k2=(42,70),a2=(48,86),e1=(36,40),w1=(40,52),e2=(34,40),w2=(38,52),props=["wall","toesup"]),
 "facepull":  dict(h=(48,20),n=(48,32),p=(48,57),k1=(52,74),a1=(54,90),k2=(46,74),a2=(42,90),e1=(36,22),w1=(56,20),e2=(34,23),w2=(54,21),anchor=(94,20)),
 "reardelt":  dict(front=1,h=(50,26),n=(50,36),p=(50,60),k1=(44,75),a1=(43,90),k2=(56,75),a2=(57,90),e1=(36,40),w1=(22,44),e2=(64,40),w2=(78,44),props=["bentnote"]),
 "pullover":  dict(h=(70,56),n=(60,59),p=(32,59),k1=(16,62),a1=(12,89),k2=(18,62),a2=(14,89),e1=(76,50),w1=(90,46),e2=(75,51),w2=(89,47),props=["bench"]),
 "wallsit":   dict(h=(30,20),n=(30,32),p=(30,60),k1=(56,60),a1=(56,89),k2=(54,61),a2=(54,89),e1=(36,46),w1=(44,56),e2=(34,46),w2=(42,56),props=["wall"]),
 "twist":      dict(front=1,h=(50,18),n=(50,30),p=(50,56),k1=(45,73),a1=(43,90),k2=(56,73),a2=(58,90),e1=(62,22),w1=(76,12),e2=(66,24),w2=(78,14),anchor=(92,4)),
}
SEG = {"chest":"ut","back":"ut","lats":"ut","abs":"lt","obliques":"lt","lower_back":"lt","glutes":"hip","shoulders":"sh",
       "quads":"th","hamstrings":"th","calves":"sn","biceps":"ua","triceps":"ua","forearms":"fa","cardio":"heart"}

def L(a,b,c,w=W): return f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="{c}" stroke-width="{w}" stroke-linecap="round"/>'
def C(a,r,c): return f'<circle cx="{a[0]}" cy="{a[1]}" r="{r}" fill="{c}"/>'
def R(x,y,w,h,c,rx=2): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{c}"/>'
mid=lambda a,b:((a[0]+b[0])/2,(a[1]+b[1])/2)

def props_svg(p, pose):
    o=[]; e=lambda *a: o.append(*a)
    for pr in pose.get("props",[]):
        if pr=="bench": e(R(16,64,58,5,EQ+"99")); e(L((24,69),(24,88),EQ+"99",4)); e(L((66,69),(66,88),EQ+"99",4))
        if pr=="ibench": e(L((30,42),(56,74),EQ+"99",6)); e(L((52,74),(52,88),EQ+"99",4))
        if pr=="lbench": e(R(6,62,24,6,EQ+"99")); e(L((14,68),(14,88),EQ+"99",4))
        if pr=="seat": e(R(30,70,26,5,EQ+"99")); e(L((43,75),(43,89),EQ+"99",4))
        if pr=="rseat": e(L((14,42),(44,78),EQ+"99",6))
        if pr=="sled": e(L((64,34),(80,58),EQ,5))
        if pr=="pad": e(C((83,61),4,EQ))
        if pr=="block": e(R(40,84,22,6,EQ+"99"))
        if pr=="pullbar": e(L((24,9),(80,9),EQ,4))
        if pr=="dipbar": e(L((36,60),(66,60),EQ,4)); e(L((62,60),(62,89),EQ+"99",3))
        if pr=="rail": e(L((8,86),(94,86),EQ+"99",4)); e(L((86,86),(86,60),EQ+"99",4)); e(L((42,64),(86,66),EQ+"66",2))
        if pr=="bikeframe": o.append(f'<circle cx="50" cy="80" r="9" fill="none" stroke="{EQ}99" stroke-width="3"/>'); e(L((38,56),(50,80),EQ+"99",3)); e(L((50,80),(74,52),EQ+"99",3))
        if pr=="hyperbench": e(L((30,46),(62,58),EQ+"99",6)); e(L((40,52),(40,88),EQ+"99",4)); e(C((20,78),4,EQ))
        if pr=="anklepad": e(R(2,84,16,5,EQ+"99"))
        if pr=="wheel": o.append(f'<circle cx="12" cy="82" r="7" fill="none" stroke="{EQ}" stroke-width="3"/>')
        if pr=="ellip": e(L((70,22),(66,86),EQ+"99",4)); o.append(f'<ellipse cx="46" cy="82" rx="16" ry="5" fill="none" stroke="{EQ}99" stroke-width="3"/>')
        if pr=="steps": e(L((40,88),(40,80),EQ+"99",3)); e(L((40,80),(60,80),EQ+"99",3)); e(L((60,80),(60,72),EQ+"99",3)); e(L((60,72),(80,72),EQ+"99",3)); e(L((66,50),(66,88),EQ+"99",3))
        if pr=="skipost": e(R(64,4,8,86,EQ+"55",2))
        if pr=="water": o.append(f'<path d="M4,66 q8,-5 16,0 t16,0 t16,0 t16,0 t16,0 t16,0" fill="none" stroke="#4A90D9" stroke-width="3"/>')
        if pr=="rope": o.append(f'<path d="M66,52 q6,-8 12,0 t10,0" fill="none" stroke="{EQ}" stroke-width="3"/>'); o.append(f'<path d="M64,53 q6,10 12,2 t12,4" fill="none" stroke="{EQ}99" stroke-width="3"/>')
        if pr=="uparrows": o.append(f'<path d="M30,30 l6,-8 l6,8 M70,30 l6,-8 l6,8" fill="none" stroke="{ACC2}" stroke-width="3" stroke-linecap="round"/>')
        if pr=="fseat": e(R(34,58,32,6,EQ+"99")); e(R(44,30,12,30,EQ+"55"))
        if pr=="kneepads": e(R(22,58,8,14,EQ)); e(R(70,58,8,14,EQ))
        if pr=="wall": e(R(4,6,8,84,EQ+"66",1))
        if pr=="toesup": o.append(f'<path d="M60,78 l4,-6 l4,6" fill="none" stroke="{ACC2}" stroke-width="3" stroke-linecap="round"/>')
        if pr=="bentnote": pass
        if pr=="motion": e(L((30,84),(70,84),GROUND,3)); e(L((40,92),(60,92),GROUND,3))
    return "".join(o)

def equip_svg(eq, pose, name):
    o=[]; w1,w2=pose["w1"],pose["w2"]; front=pose.get("front")
    n=name.lower()
    if eq=="cable":
        a=pose.get("anchor",(92,6)); o.append(L(w1,a,EQ+"cc",2)); o.append(C(a,4,EQ))
        if pose.get("anchor2"): o.append(L(w2,pose["anchor2"],EQ+"cc",2)); o.append(C(pose["anchor2"],4,EQ))
        o.append(C(w1,3,EQ))
    if eq=="machine":
        o.insert(0, R(84,8,6,82,EQ+"44",2)); o.insert(0, R(76,10,14,8,EQ+"55",2))
    if eq in("barbell","smith"):
        if eq=="smith": o.insert(0,L((10,4),(10,92),EQ+"55",3)); o.insert(0,L((90,4),(90,92),EQ+"55",3))
        if front: o.append(L((w1[0]-12,w1[1]),(w2[0]+12,w2[1]),EQ,3)); o+= [R(w1[0]-16,w1[1]-9,5,18,EQ),R(w2[0]+11,w2[1]-9,5,18,EQ)]
        else: o.append(f'<circle cx="{w1[0]}" cy="{w1[1]}" r="10" fill="none" stroke="{EQ}" stroke-width="4"/>'); o.append(C(w1,3,EQ))
    if eq=="dumbbell":
        for w in ([w1,w2] if front else [w1]):
            o.append(L((w[0]-6,w[1]),(w[0]+6,w[1]),EQ,3)); o+= [R(w[0]-9,w[1]-5,4,10,EQ,1),R(w[0]+5,w[1]-5,4,10,EQ,1)]
    if eq=="kettlebell":
        o.append(f'<path d="M{w1[0]-4},{w1[1]+2} a4,4 0 0 1 8,0" fill="none" stroke="{EQ}" stroke-width="2.5"/>'); o.append(C((w1[0],w1[1]+9),6.5,EQ))
    if eq=="landmine": o.append(L(w1,(92,88),EQ,4)); o.append(C((92,88),3,EQ))
    if eq=="band": o.append(f'<path d="M{w1[0]},{w1[1]} Q{w1[0]+10},{(w1[1]+88)/2} {pose["a1"][0]},88" fill="none" stroke="{ACC2}" stroke-width="2" stroke-dasharray="3 2"/>')
    return "".join(o)

def figure(pose, prim, sec):
    hl={}
    for m in sec: hl[SEG.get(m)]=ACC2
    for m in prim: hl[SEG.get(m)]=ACC
    front=pose.get("front"); farc=NEAR if front else FAR
    def col(seg,base): return hl.get(seg,base)
    j=pose; ut_mid=mid(j["n"],j["p"]); o=[]
    o.append(f'<line x1="6" y1="91.5" x2="94" y2="91.5" stroke="{GROUND}" stroke-width="2" stroke-linecap="round"/>')
    o.append(props_svg(None,pose))
    # far limbs
    o.append(L(j["p"],j["k2"],col("th",farc) if front or hl.get("th") else farc)); o.append(L(j["k2"],j["a2"],col("sn",farc) if front or hl.get("sn") else farc))
    o.append(L(j["n"],j["e2"],col("ua",farc) if front or hl.get("ua") else farc)); o.append(L(j["e2"],j["w2"],col("fa",farc) if front or hl.get("fa") else farc))
    if not front:  # dim far highlight
        o=[s.replace(ACC,ACC+"aa").replace(ACC2+'"',ACC2+'99"') if i>=2 else s for i,s in enumerate(o)]
    # torso
    o.append(L(j["n"],ut_mid,col("ut",NEAR),W+3)); o.append(L(ut_mid,j["p"],col("lt",NEAR),W+3))
    if "hip" in hl: o.append(C(j["p"],7.5,hl["hip"]))
    o.append(L(j["p"],j["k1"],col("th",NEAR))); o.append(L(j["k1"],j["a1"],col("sn",NEAR)))
    if "sh" in hl: o.append(C(j["n"],7,hl["sh"]))
    o.append(C(j["h"],7.5,NEAR))
    o.append(L(j["n"],j["e1"],col("ua",NEAR))); o.append(L(j["e1"],j["w1"],col("fa",NEAR)))
    if "heart" in hl: o.append(f'<path d="M86,14 c-3,-5 -10,-2 -7,3 l7,7 l7,-7 c3,-5 -4,-8 -7,-3z" fill="{hl["heart"]}"/>')
    return "".join(o)

def svg(pattern, eq, prim, sec, name=""):
    pose=P[pattern]; body=figure(pose,prim,sec); ov=equip_svg(eq,pose,name)
    back = ov if eq in ("machine","smith") else ""; fore = "" if back else ov
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
            f'<rect width="100" height="100" rx="18" fill="{BG}"/><g transform="translate(7,8) scale(0.86)">{back}{body}{fore}</g></svg>')

# ---------- mapping ----------
RULES = [  # (regex on name, pattern, eq_override or None, low_conf)
 (r"tibialis|toes walk","tibialis",None,0),
 (r"nordic|glute ham","nordic",None,0),
 (r"reverse hyper","legcurl","machine",0),
 (r"superman","hollow",None,0),
 (r"back extension|45-degree|hyperextension","backext",None,0),
 (r"standing cable abduction","abduct","cable",0),(r"clamshell","abduct",None,0),(r"hip abduction","abductm","machine",0),
 (r"face pull","facepull","cable",0),(r"rear delt","reardelt",None,0),(r"pullover","pullover",None,0),(r"wall sit","wallsit",None,0),
 (r"shrug","shrug",None,0),(r"upright row","shrug",None,0),
 (r"hollow","hollow",None,0),(r"dead bug","deadbug",None,0),(r"ab wheel","rollout",None,0),(r"pallof","pallof","cable",0),(r"vacuum","grip",None,1),
 (r"wrist curl|roller","wrist",None,0),(r"pinch|fat-grip","grip",None,0),
 (r"elliptical","elliptical",None,0),(r"stair","stair",None,0),(r"ski erg","ski","cable",0),(r"swim","swim",None,0),(r"battle rope","ropes",None,0),
 (r"sliding leg curl|swiss-ball leg curl","deadbug",None,1),
 (r"leg[- ]press calf|smith calf|donkey calf|seated.*calf|standing calf|single-leg calf|band calf|jump calf|calf raise", "calf",None,0),
 (r"tibialis|toes walk","calf",None,1),
 (r"leg press","legpress","machine",0),(r"leg extension|sissy","legext",None,0),
 (r"nordic|glute ham|sliding leg curl|swiss-ball leg curl","legcurl",None,1),(r"leg curl","legcurl","machine",0),
 (r"hip thrust|glute bridge|frog pump","thrust",None,0),
 (r"hip abduction|cable abduction|clamshell","abduct",None,1),
 (r"kickback$|donkey kick|bird dog|cable kickback","quadruped",None,0),
 (r"tricep kickback","row",None,0),
 (r"reverse hyper|superman|back extension|45-degree|hyperextension","legcurl",None,1),
 (r"rdl|romanian|deadlift|good morning|rack pull|pull-through|swing|hip hinge","hinge",None,0),
 (r"lunge|split squat|step up|curtsy","lunge",None,0),
 (r"wall sit","squat",None,1),(r"jump squat|box jump|burpee|jump rope|high knees","jump",None,0),
 (r"squat","squat",None,0),
 (r"pulldown|pull-down","pulldown","cable",0),(r"straight-arm","pulldown","cable",1),
 (r"pull up|pull-up|\bchin|dead hang|towel hang|scapular","vpull",None,0),
 (r"hanging .*raise|windshield","legraise",None,0),
 (r"seated cable row|machine row","seatrow",None,0),
 (r"face pull","seatrow","cable",1),
 (r"inverted row","plank",None,1),
 (r"row(?!ing)","row",None,0),
 (r"upright row|shrug","carry",None,1),
 (r"incline (bench|dumbbell press)|incline.*press","ipress",None,0),
 (r"decline push|incline push|diamond push|wide push|push up|pushup|pike push","pushup",None,0),
 (r"bench press|floor press|chest press|squeeze press|hex press|jm press|tate press|close-grip bench","hpress",None,0),
 (r"overhead press|shoulder press|arnold|landmine press|cuban|pike","ohpress",None,0),
 (r"pushdown","pushdown","cable",0),
 (r"dip","dip",None,0),
 (r"skull|lying.*extension|overhead.*extension|triceps extension","triext",None,0),
 (r"pullover","hpress",None,1),
 (r"rear delt|face pull","row",None,1),
 (r"lateral raise|front raise|bus driver","latraise",None,0),
 (r"fly|crossover|pec deck|around the world","fly",None,0),
 (r"wrist|roller|pinch|fat-grip","curl",None,1),
 (r"curl","curl",None,0),
 (r"carry","carry",None,0),
 (r"^plank$|side plank|copenhagen","plank",None,0),(r"hollow|vacuum|dead bug|pallof|ab wheel","plank",None,1),
 (r"crunch|sit[- ]up|v-up|toe touch|dragon flag|heel tap|russian twist","crunch",None,0),
 (r"woodchop|rotation","twist",None,0),(r"mountain climber","plank",None,0),
 (r"rowing erg","rower",None,0),(r"bike|bicycle(?! crunch)","bike",None,0),
 (r"run|elliptical|stair|ski erg|battle rope|swim","run",None,0),
]
LOWC = {"run":[]}

def map_ex(e, ov):
    n=e["name"].lower(); slug=e["slug"]
    eq=e["equipment"]; pat=None; low=0; rule="fallback"
    for rx,pt,eo,lc in RULES:
        if re.search(rx,n): pat,low,rule=pt,lc,rx; eq=eo or eq; break
    if pat=="run" and any(k in n for k in LOWC["run"]): low=1
    if "cable" in n or "pushdown" in n: eq="cable"
    if "smith" in n: eq="smith"
    if "landmine" in n: eq="landmine"
    if n.startswith("band "): eq="band"
    if pat is None:
        m=e["primary_muscle_slug"]; pat={"quads":"squat","hamstrings":"hinge","glutes":"thrust","chest":"hpress","back":"row","lats":"vpull",
          "shoulders":"ohpress","biceps":"curl","triceps":"triext","abs":"crunch","obliques":"twist","calves":"calf","cardio":"run"}.get(m,"stand"); low=1
    if slug in ov: o=ov[slug]; pat=o.get("pattern",pat); eq=o.get("equipment",eq); low=o.get("low",0)
    if e["category"] in ("cardio","plyo") and pat not in ("run","jump","rower","bike","plank","crunch","squat","calf","elliptical","stair","ski","swim","ropes","hinge","pushup","lunge"): low=1
    return pat, eq, low, rule

def png(svgs, size):
    import cairosvg; return cairosvg.svg2png(bytestring=svgs.encode(), output_width=size, output_height=size)

def main(export=False):
    d=json.load(open(os.environ.get("EXERCISES_JSON","exercises.json")))
    d=d["ex"] if isinstance(d,dict) else d
    ov=json.load(open("overrides.json")) if os.path.exists("overrides.json") else {}
    os.makedirs("out/svg",exist_ok=True); rows=[]; recs={}
    for e in sorted(d,key=lambda x:x["slug"]):
        pat,eq,low,rule=map_ex(e,ov); prim=[e["primary_muscle_slug"]]; sec=e["secondary_muscle_slugs"]
        s=svg(pat,eq,prim,sec,e["name"]); recs[e["slug"]]=(e["name"],s)
        open(f"out/svg/{e['slug']}.svg","w").write(s)
        rows.append(dict(slug=e["slug"],name=e["name"],pattern=pat,equipment=eq,primary_muscles=";".join(prim),secondary_muscles=";".join(sec),low_confidence=low))
    with open("mapping.csv","w",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    # day + equipment icons
    days={"push":("hpress","barbell",["chest"],["shoulders","triceps"]),"pull":("vpull","bodyweight",["lats"],["biceps","back"]),
          "legs":("squat","barbell",["quads"],["glutes","hamstrings"]),"upper":("frontall","bodyweight",["chest","shoulders","biceps","triceps","back"],[]),
          "lower":("frontall","bodyweight",["quads","hamstrings","glutes","calves"],[]),
          "full_body":("frontall","bodyweight",["chest","shoulders","biceps","triceps","abs","quads","calves","glutes"],[]),
          "conditioning":("run","bodyweight",["cardio"],["quads","calves"])}
    for k,(pt,eq,pr,se) in days.items(): recs["day-"+k]=(k,svg(pt,eq,pr,se))
    recs["day-rest"]=("rest",f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="{BG}"/><path d="M62,22 a30,30 0 1,0 18,46 a24,24 0 1,1 -18,-46z" fill="{NEAR}"/><text x="70" y="36" font-family="sans-serif" font-weight="700" font-size="14" fill="{ACC2}">z</text></svg>')
    eqi={"barbell":L((10,50),(90,50),EQ,4)+R(18,32,8,36,EQ)+R(28,37,6,26,EQ)+R(74,32,8,36,EQ)+R(66,37,6,26,EQ),
         "dumbbell":L((30,50),(70,50),EQ,6)+R(18,34,10,32,EQ,3)+R(72,34,10,32,EQ,3),
         "kettlebell":f'<path d="M36,44 v-8 a14,14 0 0 1 28,0 v8" fill="none" stroke="{EQ}" stroke-width="7"/>'+C((50,62),22,EQ),
         "machine":R(16,12,10,76,EQ+"aa")+R(30,58,40,8,EQ)+L((48,66),(48,86),EQ,5)+L((26,20),(76,20),EQ,4)+R(68,26,14,26,EQ+"77"),
         "bodyweight":figure(P["frontall"],[],[])}
    for k,b in eqi.items(): recs["equip-"+k]=(k,f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="{BG}"/>{b}</svg>')
    for k,(nm,s) in recs.items():
        if not k in [r["slug"] for r in rows]: open(f"out/svg/{k}.svg","w").write(s)
    if export:
        from PIL import Image
        for sz in (96,192): os.makedirs(f"out/png{sz}",exist_ok=True); os.makedirs(f"out/webp{sz}",exist_ok=True)
        for k,(nm,s) in recs.items():
            for sz in (96,192):
                b=png(s,sz); open(f"out/png{sz}/{k}.png","wb").write(b); Image.open(io.BytesIO(b)).save(f"out/webp{sz}/{k}.webp",quality=90)
    return rows,recs

def sheet(recs, keys, path):
    from PIL import Image, ImageDraw, ImageFont
    cols=4; cw,ch=300,150; rows=(len(keys)+cols-1)//cols
    img=Image.new("RGB",(cols*cw,rows*ch+50),"#0B0D12"); dr=ImageDraw.Draw(img)
    try: f=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",13); fb=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",18)
    except Exception: f=fb=ImageFont.load_default()
    dr.text((12,14),"IronFlow thumbnails – review sheet (40px and 96px)",font=fb,fill="#E6EAF2")
    for i,k in enumerate(keys):
        x=(i%cols)*cw+12; y=(i//cols)*ch+60; nm,s=recs[k]
        a=Image.open(io.BytesIO(png(s,40))).convert("RGBA"); b=Image.open(io.BytesIO(png(s,96))).convert("RGBA")
        img.paste(a,(x,y+28),a); img.paste(b,(x+52,y),b)
        tx=x+158
        words=nm.split(); line=""; ly=y+10
        for wd in words:
            if len(line+" "+wd)>16: dr.text((tx,ly),line.strip(),font=f,fill="#E6EAF2"); ly+=17; line=""
            line+=" "+wd
        dr.text((tx,ly),line.strip(),font=f,fill="#E6EAF2")
        dr.text((tx,ly+20),k[:22],font=f,fill="#7A8396")
    img.save(path)

if __name__=="__main__":
    if "--module" in sys.argv: i=sys.argv.index("--module")+1; sys.argv[i]=os.path.abspath(sys.argv[i])
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    rows,recs=main(export="--export" in sys.argv)
    keys=["back-squat","barbell-bench-press","bent-over-row","deadlift","overhead-press","plank","pull-up","romanian-deadlift",
      "lat-pulldown","seated-cable-row","tricep-pushdown","cable-crossover","leg-press","leg-extension","lying-leg-curl","hip-thrust",
      "lateral-raise","dumbbell-curl","incline-dumbbell-press","walking-lunge","standing-calf-raise","crunch","kettlebell-swing","farmer-carry",
      "box-jump","run","rowing-erg","bike-erg","pec-deck","smith-machine-squat","dips","day-push","day-legs","day-conditioning","day-rest","equip-machine"]
    if "--sheet" in sys.argv: sheet(recs,[k for k in keys if k in recs],"sample-sheet.png")
    from collections import Counter
    print(Counter(r["pattern"] for r in rows)); print("low:",sum(int(r["low_confidence"]) for r in rows), "eq:",Counter(r["equipment"] for r in rows))

# ---------- compact TS module for the app ----------
COLTOK = {BG:"~b",NEAR:"~n",FAR:"~f",ACC:"~a",ACC2:"~s",EQ:"~e",GROUND:"~g"}
def compact(s):
    def ln(m):
        x1,y1,x2,y2,c,w=m.groups(); return f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{c}" stroke-width="{w}"/>'
    s=re.sub(r'<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-linecap="round"/>',ln,s)
    s=re.sub(r'(\d+\.\d{2})\d+',r'\1',s)
    s=re.sub(r'^<svg[^>]*>','',s).replace('</svg>','')
    for k,v in sorted(COLTOK.items(),key=lambda kv:-len(kv[0])): s=s.replace(k,v)
    return s
def write_module(recs, rows, path):
    bodies=[]; idx={}; m={}
    for k,(nm,s) in recs.items():
        c=compact(s)
        if c not in idx: idx[c]=len(bodies); bodies.append(c)
        m[k]=idx[c]
    eqmap={r["slug"]:r["equipment"] for r in rows}
    out=["// AUTO-GENERATED by tools/exercise-icons/gen.py. Do not edit by hand.",
         f"export const ICON_COLORS = {json.dumps({v:k for k,v in COLTOK.items()})} as const;",
         f"export const ICON_BODIES: readonly string[] = {json.dumps(bodies,separators=(',',':'))};",
         f"export const ICON_INDEX: Readonly<Record<string, number>> = {json.dumps(m,separators=(',',':'))};",
         f"export const ICON_EQUIPMENT: Readonly<Record<string, string>> = {json.dumps(eqmap,separators=(',',':'))};",""]
    open(path,"w").write("\n".join(out)); return len(bodies)
if __name__=="__main__" and "--module" in sys.argv:
    p=sys.argv[sys.argv.index("--module")+1]; n=write_module(recs,rows,p); print("module bodies",n,"bytes",os.path.getsize(p))
