#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# git filter-repo message callback: rewrite non-English commit messages to English.
# Lookup table (sha -> new_subject, new_body) is generated from history-mapping.tsv.
# Bodies in the TSV are written on a single logical line with the literal escape \n
# for newlines; we expand those back to real newlines here so the file stays
# well-formed as a 3-column tab-separated table.
import sys

MAP_FILE = 'scripts/release/history-mapping.tsv'
MAP = {}

def _unescape(s: str) -> str:
    return s.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')

with open(MAP_FILE, encoding='utf-8') as f:
    for line in f:
        # Strip one trailing newline only; embedded \n are the literal escape.
        if line.endswith('\n'):
            line = line[:-1]
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) < 2 or len(parts[0]) != 40:
            continue
        sha = parts[0]
        subject = _unescape(parts[1])
        body = _unescape(parts[2]) if len(parts) > 2 else ''
        MAP[sha] = (subject, body)

def callback(message, metadata):
    sha = metadata['original_id'].decode()
    if sha not in MAP:
        return message
    subject, body = MAP[sha]
    if body:
        return (subject + '\n\n' + body + '\n').encode('utf-8')
    return (subject + '\n').encode('utf-8')
