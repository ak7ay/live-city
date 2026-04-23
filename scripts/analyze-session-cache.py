#!/usr/bin/env python3
"""Analyze Claude Agent SDK session JSONLs for cache effectiveness + phase-1 token cost.

Usage:
  scripts/analyze-session-cache.py <session-dir> --after-ts <unix-seconds>

For every JSONL in the directory whose mtime is > after-ts, classifies the
session by its first user message (p1/p2/p3/?), then computes:
  - First-call cache_create / cache_read (cross-session reuse signal)
  - Deduped-by-request-id total input/cache_create/cache_read/output
  - Effective tokens: input + cache_create + 0.1 * cache_read + output

Emits a table sorted by mtime.
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime


def classify(path):
    first_user = ""
    for line in open(path):
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") == "user" and not first_user:
            msg = obj.get("message", {})
            c = msg.get("content", "")
            if isinstance(c, list):
                c = " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
            first_user = str(c)[:500]
            break

    label = "?"
    src = "-"
    s = first_user.lower()
    if "extract news stories" in s or ("phase 1" in s and "extract" in s):
        label = "p1"
    elif "select the top" in s or "select the" in s and "most important" in s:
        label = "p2"
    elif "fetch and translate" in s or "translate the following" in s:
        label = "p3"
    if "publictv" in s:
        src = "publictv"
    elif "tv9kannada" in s:
        src = "tv9"
    elif "dailythanthi" in s:
        src = "dailythanthi"
    elif "polimer" in s:
        src = "polimer"
    return label, src


def session_usage(path):
    seen = set()
    first_cc = first_cr = None
    tot_in = tot_cc = tot_cr = tot_out = 0
    n = 0
    for line in open(path):
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") != "assistant":
            continue
        msg = obj.get("message", {})
        usage = msg.get("usage", {})
        if not usage:
            continue
        req = obj.get("requestId") or msg.get("id")
        if req in seen:
            continue
        seen.add(req)
        in_t = usage.get("input_tokens", 0)
        cc = usage.get("cache_creation_input_tokens", 0)
        cr = usage.get("cache_read_input_tokens", 0)
        out = usage.get("output_tokens", 0)
        if first_cc is None:
            first_cc = cc
            first_cr = cr
        tot_in += in_t
        tot_cc += cc
        tot_cr += cr
        tot_out += out
        n += 1
    eff = tot_in + tot_cc + tot_cr * 0.1 + tot_out
    return {"first_cc": first_cc or 0, "first_cr": first_cr or 0, "tot_in": tot_in, "tot_cc": tot_cc, "tot_cr": tot_cr, "tot_out": tot_out, "eff": int(eff), "n_calls": n}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--after-ts", type=int, default=0)
    ap.add_argument("--before-ts", type=int, default=9999999999)
    args = ap.parse_args()

    files = sorted(glob.glob(f"{args.dir}/*.jsonl"), key=lambda p: os.path.getmtime(p))
    files = [p for p in files if args.after_ts <= os.path.getmtime(p) <= args.before_ts]

    print(f"sessions: {len(files)} (window: {args.after_ts}..{args.before_ts})")
    print(
        f"{'time':>9}  {'session':10s}  {'phase':5s}  {'src':10s}  "
        f"{'first_cc':>9}  {'first_cr':>9}  {'tot_cc':>8}  {'tot_cr':>8}  {'out':>6}  {'eff':>7}  calls"
    )
    print("-" * 105)

    totals = {"p1": 0, "p2": 0, "p3": 0, "?": 0}
    for p in files:
        mt = datetime.fromtimestamp(os.path.getmtime(p)).strftime("%H:%M:%S")
        label, src = classify(p)
        u = session_usage(p)
        name = os.path.basename(p).split("-")[0]
        print(
            f"{mt:>9}  {name:10s}  {label:5s}  {src:10s}  "
            f"{u['first_cc']:>9}  {u['first_cr']:>9}  {u['tot_cc']:>8}  {u['tot_cr']:>8}  {u['tot_out']:>6}  {u['eff']:>7}  {u['n_calls']}"
        )
        totals[label] = totals.get(label, 0) + u["eff"]

    print("-" * 105)
    print(f"Totals: p1={totals['p1']}  p2={totals['p2']}  p3={totals['p3']}  ?={totals['?']}  all={sum(totals.values())}")


if __name__ == "__main__":
    main()
