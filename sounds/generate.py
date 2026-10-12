"""Synthesizes the casino's WAVs next to this file: python generate.py"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).parent
rng = random.Random(7)


def silence(seconds):
    return [0.0] * int(seconds * RATE)


def mix(buf, part, at):
    start = int(at * RATE)
    need = start + len(part)
    if need > len(buf):
        buf.extend([0.0] * (need - len(buf)))
    for i, v in enumerate(part):
        buf[start + i] += v


def env(n, attack=0.005, release=0.05):
    a, r = int(attack * RATE), int(release * RATE)
    out = []
    for i in range(n):
        g = 1.0
        if i < a:
            g = i / max(a, 1)
        if i > n - r:
            g = min(g, (n - i) / max(r, 1))
        out.append(g)
    return out


def tone(freq, seconds, kind="square", vol=0.3, vibrato=0.0, slide=0.0, decay=0.0):
    n = int(seconds * RATE)
    e = env(n)
    out, phase = [], 0.0
    for i in range(n):
        t = i / RATE
        f = freq * (1 + slide * t / seconds) * (1 + vibrato * math.sin(2 * math.pi * 5.5 * t))
        phase += f / RATE
        p = phase % 1.0
        if kind == "square":
            v = 1.0 if p < 0.5 else -1.0
        elif kind == "saw":
            v = 2 * p - 1
        elif kind == "tri":
            v = 4 * abs(p - 0.5) - 1
        else:
            v = math.sin(2 * math.pi * p)
        g = math.exp(-decay * t) if decay else 1.0
        out.append(v * vol * e[i] * g)
    return out


def noise(seconds, vol=0.3, decay=30.0):
    n = int(seconds * RATE)
    return [rng.uniform(-1, 1) * vol * math.exp(-decay * i / RATE) for i in range(n)]


def click(vol=0.25):
    return [a + b for a, b in zip(noise(0.012, vol, 300), tone(1800, 0.012, "sine", vol * 0.6, decay=250))]


def clunk(pitch):
    body = tone(90, 0.18, "sine", 0.6, slide=-0.4, decay=22)
    ping = tone(pitch, 0.25, "sine", 0.18, decay=14)
    hit = noise(0.05, 0.35, 70)
    out = [0.0] * len(ping)
    for part in (body, ping, hit):
        for i, v in enumerate(part):
            out[i] += v
    return out


def bell(freq, vol=0.2):
    a = tone(freq, 0.6, "sine", vol, decay=6)
    b = tone(freq * 2.76, 0.6, "sine", vol * 0.4, decay=10)
    return [x + y for x, y in zip(a, b)]


def note(name):
    names = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    letter, octave = name[0], int(name[-1])
    semis = names[letter] + (1 if "#" in name else 0) - (1 if "b" in name[1:-1] else 0) + (octave - 4) * 12
    return 440 * 2 ** (semis / 12)


# Spin: lever, rolling ticks that thin out as each reel stops, three clunks.
STOPS = [1.2, 1.6, 2.0]


def spin():
    buf = silence(2.1)
    mix(buf, noise(0.08, 0.5, 40), 0.0)
    mix(buf, tone(120, 0.15, "sine", 0.5, slide=-0.5, decay=18), 0.02)
    t = 0.12
    while t < STOPS[-1]:
        running = sum(1 for s in STOPS if t < s)
        mix(buf, click(0.08 * running), t)
        t += 0.045 + 0.02 * (3 - running)
    mix(buf, tone(70, STOPS[-1] - 0.1, "tri", 0.06), 0.1)
    for s, pitch in zip(STOPS, (660, 740, 880)):
        mix(buf, clunk(pitch), s)
    return buf


def win():
    buf = []
    for i, n in enumerate(["C5", "E5", "G5", "C6"]):
        mix(buf, tone(note(n), 0.09, "square", 0.16), i * 0.08)
    for n in ("C5", "E5", "G5", "C6"):
        mix(buf, tone(note(n), 0.45, "square", 0.07, decay=4), 0.34)
    return buf


def jackpot():
    buf = []
    run = ["C5", "E5", "G5", "C6", "E6", "G6", "C7"]
    for rep in range(2):
        for i, n in enumerate(run):
            mix(buf, tone(note(n), 0.07, "square", 0.14), rep * 0.5 + i * 0.065)
    for n in ("C5", "G5", "C6", "E6"):
        mix(buf, tone(note(n), 0.9, "saw", 0.06, vibrato=0.006, decay=2), 1.0)
    for i in range(3):
        mix(buf, bell(1568), 1.0 + i * 0.28)
    for _ in range(26):
        mix(buf, bell(rng.choice([2093, 2349, 2637, 3136]), 0.07), 1.2 + rng.random() * 1.6)
    return buf


def lose():
    buf = []
    for i, (n, d) in enumerate([("G4", 0.32), ("F#4", 0.32), ("F4", 0.32), ("E4", 0.95)]):
        mix(buf, tone(note(n) / 2, d, "saw", 0.22, vibrato=0.012 if i == 3 else 0.004, slide=-0.02), i * 0.36)
    return buf


def ci_win():
    buf = []
    for i, n in enumerate(["G5", "C6", "E6", "G6"]):
        mix(buf, bell(note(n), 0.18), i * 0.11)
    mix(buf, win(), 0.5)
    return buf


def ci_lose():
    buf = []
    for i in range(3):
        mix(buf, tone(110, 0.22, "square", 0.18), i * 0.3)
    return buf


def write(name, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = min(1.0, 0.9 / peak)
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, s * gain)) * 32767)) for s in samples)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)


def then(first, second, at):
    buf = list(first)
    mix(buf, second, at)
    return buf


# One file per spin outcome, so a spin is one process and the result lands on the last clunk.
write("spin-win", then(spin(), win(), 2.15))
write("spin-jackpot", then(spin(), jackpot(), 2.15))
write("spin-lose", then(spin(), lose(), 2.2))
write("ci-win", ci_win())
write("ci-lose", ci_lose())
