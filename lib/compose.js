/**
 * One-step vocal composition through the bridge: tempo, track naming, notes
 * with lyrics, then an independent read-back verification.
 *
 * Group resolution rules:
 * - explicit `groupIndex` wins;
 * - a non-main group named like `groupName`/`trackName` is reused (append);
 * - otherwise the track's main group is used, and writing there with
 *   `grouping: "ensureNonMain"` creates one reusable dedicated vocal group.
 */
const BLICKS_PER_QUARTER = 705_600_000;
const MAX_GROUPS = 32;

/** @returns {number} blicks for a quarter-note beat count. */
export function beatsToBlicks(beats) {
  return Math.round(beats * BLICKS_PER_QUARTER);
}

/**
 * Normalize a caller-supplied note list into bridge note payloads.
 * @param {{ onset: number, duration: number, pitch: number, lyric?: string }[]} notes
 * @param {string} [fallbackLyric]
 * @returns {{ notes: any[], warnings: string[] }}
 */
export function normalizeNotes(notes, fallbackLyric = "la") {
  const warnings = [];
  let missingLyrics = 0;
  if (!Array.isArray(notes) || notes.length === 0) {
    throw new Error("notes 不能为空：请提供 [{ onset, duration, pitch, lyric }]（单位为四分音符拍）。");
  }
  if (notes.length > 512) {
    throw new Error("一次最多写入 512 个音符；请分批调用 synthv_compose。");
  }
  const normalized = notes.map((note, index) => {
    const onset = Number(note?.onset);
    const duration = Number(note?.duration);
    const pitch = Number(note?.pitch);
    if (!Number.isFinite(onset) || onset < 0) {
      throw new Error(`notes[${index}].onset 必须是 >= 0 的数字（拍）。`);
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`notes[${index}].duration 必须是 > 0 的数字（拍）。`);
    }
    if (!Number.isFinite(pitch) || pitch < 0 || pitch > 127) {
      throw new Error(`notes[${index}].pitch 必须是 0-127 的 MIDI 音高。`);
    }
    let lyric = typeof note?.lyric === "string" ? note.lyric.trim() : "";
    if (lyric.length === 0) {
      lyric = fallbackLyric;
      missingLyrics += 1;
    }
    return {
      onset: beatsToBlicks(onset),
      duration: beatsToBlicks(duration),
      pitch: Math.round(pitch),
      lyrics: lyric,
    };
  });
  if (missingLyrics > 0) {
    warnings.push(`${missingLyrics} 个音符缺少 lyric，已使用默认歌词 "${fallbackLyric}"。`);
  }
  return { notes: normalized, warnings };
}

/** @returns {Promise<any>} bridge connection status, throws when unusable. */
async function assertBridgeWritable(client) {
  const status = await client.status();
  const session = status?.status?.sessionToken ?? status?.sessionId ?? null;
  if (!status?.connected || !status?.fresh) {
    const reason = status?.reason ? `（原因：${status.reason}）` : "";
    throw new Error(
      `SynthV 常驻桥未连接${reason}。请先在 SynthV 中点击：脚本 → SynthV Agent Bridge → Start SynthV Agent Bridge，然后重试。`,
    );
  }
  if (status.coherence && status.coherence.writesAllowed === false) {
    throw new Error(
      `SynthV 桥已连接但拒绝写入：${JSON.stringify(status.coherence)}。请运行 synthv_bridge { action: 'ensure' } 修复。`,
    );
  }
  return { ...status, sessionToken: session };
}

/** @returns {Promise<any[]>} groups of a track with write contexts. */
async function readGroups(client, trackIndex) {
  const result = await client.callTool("sv_query", {
    action: "get_track_notes",
    args: {
      trackIndex,
      groupOffset: 0,
      groupLimit: MAX_GROUPS,
      offset: 0,
      limit: 1,
    },
    contextMode: "writeIntent",
  });
  return Array.isArray(result?.groups) ? result.groups : [];
}

/** @param {any[]} groups @returns {number} total notes across groups. */
function totalNotes(groups) {
  return groups.reduce((sum, group) => sum + Number(group?.noteCount ?? 0), 0);
}

/**
 * Compose (or extend) a vocal part in the open SynthV project.
 * @param {import('./mcp.js').BridgeMcpClient} client
 * @param {{
 *   notes: { onset: number, duration: number, pitch: number, lyric?: string }[],
 *   tempoBpm?: number,
 *   trackIndex?: number,
 *   groupIndex?: number,
 *   trackName?: string,
 *   groupName?: string,
 *   displayColor?: string,
 *   fallbackLyric?: string,
 *   dryRun?: boolean,
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function composeVocalPart(client, options) {
  const trackIndex = Math.max(1, Math.round(options.trackIndex ?? 1));
  const { notes, warnings } = normalizeNotes(options.notes, options.fallbackLyric ?? "la");
  const steps = [];

  const status = await assertBridgeWritable(client);
  steps.push(`桥连接正常（session=${status.sessionToken ?? "unknown"}）`);

  const project = await client.callTool("sv_query", {
    action: "get_project_info",
    args: {},
    contextMode: "readOnly",
  });
  steps.push(`当前工程：${project?.trackCount ?? "?"} 轨，时长 ${project?.durationBlicks ?? 0} blicks`);

  if (Number.isFinite(options.tempoBpm) && Number(options.tempoBpm) > 0) {
    const timeAxis = await client.callTool("sv_query", {
      action: "get_time_axis",
      args: { tempoOffset: 0, tempoLimit: 32, measureOffset: 0, measureLimit: 32 },
      contextMode: "writeIntent",
    });
    if (!timeAxis?.contextId) throw new Error("无法读取时间轴写入上下文（contextId）。");
    await client.callTool("sv_command", {
      action: "set_time_axis",
      contextId: timeAxis.contextId,
      args: { tempoMarks: [{ position: 0, bpm: Number(options.tempoBpm) }] },
    });
    steps.push(`速度设为 ${options.tempoBpm} BPM`);
  }

  if (options.trackName) {
    const tracks = await client.callTool("sv_query", {
      action: "list_tracks",
      args: { offset: 0, limit: Math.max(16, trackIndex) },
      contextMode: "writeIntent",
    });
    const track = tracks?.tracks?.[trackIndex - 1];
    if (track?.contextId) {
      await client.callTool("sv_command", {
        action: "update_track",
        contextId: track.contextId,
        args: {
          name: String(options.trackName),
          ...(options.displayColor ? { displayColor: String(options.displayColor) } : {}),
        },
      });
      steps.push(`轨道 ${trackIndex} 重命名为「${options.trackName}」`);
    } else {
      warnings.push(`未能取得轨道 ${trackIndex} 的写入上下文，跳过重命名。`);
    }
  }

  const groupsBefore = await readGroups(client, trackIndex);
  const notesBefore = totalNotes(groupsBefore);
  const wantedName = (options.groupName ?? options.trackName ?? "").trim();
  const explicitGroupIndex = Number.isInteger(options.groupIndex) && options.groupIndex > 0
    ? options.groupIndex
    : null;

  let target = null;
  if (explicitGroupIndex !== null) {
    target = groupsBefore.find((group) => group.groupIndex === explicitGroupIndex) ?? null;
    if (!target) {
      throw new Error(`轨迹 ${trackIndex} 不存在第 ${explicitGroupIndex} 个音符组。`);
    }
  } else if (wantedName) {
    target = groupsBefore.find((group) => !group.main && group.name === wantedName) ?? null;
  }
  if (!target) {
    target = groupsBefore.find((group) => group.main) ?? groupsBefore[0] ?? null;
  }
  if (!target?.contextId) {
    throw new Error(`轨迹 ${trackIndex} 没有可写入的音符组，请先在 SynthV 中确认工程轨道。`);
  }

  // Writing into the main group would share Voice settings with the whole
  // track; "ensureNonMain" moves the write into a dedicated reusable group.
  const createDedicatedGroup = target.main === true && !options.dryRun;
  const grouping = createDedicatedGroup ? "ensureNonMain" : "target";
  const notesInTargetBefore = Number(target.noteCount ?? 0);
  steps.push(
    `目标：轨道 ${trackIndex} / 组 ${target.groupIndex}「${target.name ?? "main"}」，现有 ${notesInTargetBefore} 个音符` +
      (createDedicatedGroup ? "（将创建独立演唱组）" : ""),
  );

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      steps,
      warnings,
      plannedNotes: notes.length,
      noteCountBefore: notesBefore,
      targetGroupIndex: target.groupIndex,
      targetGroupName: target.name ?? "main",
    };
  }

  const command = await client.callTool("sv_command", {
    action: "add_notes",
    contextId: target.contextId,
    args: {
      trackIndex,
      groupIndex: target.groupIndex,
      notes,
      grouping,
      // `groupName` is accepted only when ensureNonMain creates a new group.
      ...(createDedicatedGroup && wantedName ? { groupName: wantedName } : {}),
    },
  });
  steps.push(`写入 ${notes.length} 个音符`);

  const groupsAfter = await readGroups(client, trackIndex);
  const notesAfter = totalNotes(groupsAfter);
  const writtenGroup =
    groupsAfter.find((group) => group.groupIndex === target.groupIndex) ??
    groupsAfter.find((group) => wantedName && group.name === wantedName) ??
    null;
  const actualGroup =
    writtenGroup && Number(writtenGroup.noteCount ?? 0) > notesInTargetBefore
      ? writtenGroup
      : groupsAfter
          .filter((group) => Number(group.noteCount ?? 0) > 0)
          .sort((a, b) => b.groupIndex - a.groupIndex)[0] ?? null;

  if (notesAfter < notesBefore + notes.length) {
    warnings.push(
      `回读校验：总音符 ${notesBefore} → ${notesAfter}，少于预期 ${notesBefore + notes.length}，请在 SynthV 中确认。`,
    );
  } else {
    steps.push(`回读校验通过：总音符 ${notesBefore} → ${notesAfter}`);
  }
  const groupNotes = Number(actualGroup?.noteCount ?? 0);
  steps.push(
    `实际写入位置：组 ${actualGroup?.groupIndex ?? "?"}「${actualGroup?.name ?? "main"}」，该组现有 ${groupNotes} 个音符`,
  );

  // The scripting API cannot enumerate installed singers; report an unset voice
  // so the agent tells the user to pick one in SynthV before listening.
  try {
    const voice = await client.callTool("sv_query", {
      action: "get_group_voice",
      args: { trackIndex, groupIndex: actualGroup?.groupIndex ?? target.groupIndex },
      contextMode: "readOnly",
    });
    const params = voice?.parameters ?? {};
    const anyParam = Object.values(params).some((value) => value !== null && value !== undefined);
    const hasModes = voice?.vocalModes && Object.keys(voice.vocalModes).length > 0;
    if (!anyParam && !hasModes) {
      warnings.push(
        "该音符组还没有选择歌声（Voice）：请到 SynthV 右侧「歌声」面板为它选择一个歌手，然后播放即可听到演唱。",
      );
    }
  } catch {
    // Voice introspection is advisory only.
  }

  return {
    ok: true,
    steps,
    warnings,
    addedNotes: notes.length,
    noteCountBefore: notesBefore,
    noteCountAfter: notesAfter,
    command,
    verification: {
      trackIndex,
      groupIndex: actualGroup?.groupIndex ?? target.groupIndex,
      groupName: actualGroup?.name ?? target.name ?? "main",
      groupNoteCount: groupNotes,
      requestedGroupIndex: target.groupIndex,
    },
  };
}
