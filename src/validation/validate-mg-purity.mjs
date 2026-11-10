/**
 * 100-Point `_mg` Purity Rubric & Pre-Flight Gate (`validate-mg-purity.mjs`).
 */

function blankRangePreservingNewlines(source, start, end) {
  const prefix = source.slice(0, start)
  const middle = source.slice(start, end).replace(/[^\n\r]/g, ' ')
  const suffix = source.slice(end)
  return prefix + middle + suffix
}

function maskHelperDefsAndComments(scriptString) {
  let masked = String(scriptString ?? '')

  const rbStart = masked.indexOf('const _rb = (function ()')
  const mgEndMarker = 'Object.assign(_mg.theme, _mg.ASTRYX_THEMES.neutral'
  const mgLegacyEndRegex = /\bsel\(\)\s*\{\s*return\s+api\.getSelection\(\)\[0\];\s*\}\s*\};/

  if (rbStart >= 0) {
    let endIdx = -1
    const markerIdx = masked.indexOf(mgEndMarker, rbStart)
    if (markerIdx >= 0) {
      const closeIdx = masked.indexOf('} catch (e) {}', markerIdx)
      if (closeIdx >= 0) {
        endIdx = closeIdx + '} catch (e) {}'.length
      }
    }
    if (endIdx < 0) {
      const legacyMatch = mgLegacyEndRegex.exec(masked.slice(rbStart))
      if (legacyMatch) {
        endIdx = rbStart + legacyMatch.index + legacyMatch[0].length
      }
    }
    if (endIdx > rbStart) {
      masked = blankRangePreservingNewlines(masked, rbStart, endIdx)
    }
  }

  const standaloneMgMatch = /(?:const|let|var)\s+_mg\s*=\s*\{[\s\S]*?\n\};/.exec(masked)
  if (standaloneMgMatch) {
    masked = blankRangePreservingNewlines(
      masked,
      standaloneMgMatch.index,
      standaloneMgMatch.index + standaloneMgMatch[0].length,
    )
  }

  const manifestRuntimeMatch = /var\s+__mgApplyManifest\s*=\s*function\s*\(manifest\)\s*\{[\s\S]*?\n\};/.exec(masked)
  if (manifestRuntimeMatch) {
    masked = blankRangePreservingNewlines(
      masked,
      manifestRuntimeMatch.index,
      manifestRuntimeMatch.index + manifestRuntimeMatch[0].length,
    )
  }

  masked = masked.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, (comment) =>
    comment.replace(/[^\n\r]/g, ' '),
  )

  return masked
}

export function gradeFromScore(score) {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

export function validateMgPurity(scriptString) {
  const raw = String(scriptString ?? '')
  const rawLines = raw.split(/\r?\n/)
  const masked = maskHelperDefsAndComments(raw)
  const maskedLines = masked.split(/\r?\n/)

  const violations = []

  const hasStartUndo = /\bapi\.startUndo(?:Group)?\s*\(/.test(masked)
  const hasTry = /\btry\s*\{/.test(masked)
  const hasFinally = /\bfinally\s*\{/.test(masked)
  const hasEndUndo = /\bapi\.endUndo(?:Group)?\s*\(/.test(masked)
  const hasExplicitUndoTryFinally = hasStartUndo && hasTry && hasFinally && hasEndUndo
  const hasMgUndoGroup = /\b_mg\.undoGroup\s*\(/.test(masked)

  let undoDeduction = 0
  if (!hasExplicitUndoTryFinally && !hasMgUndoGroup) {
    undoDeduction = 25
    violations.push({
      rule: 'atomic_undo_safety',
      line: 1,
      pointsDeducted: 25,
      snippet: (rawLines[0] ?? '').trim().slice(0, 120),
      message:
        'Line 1: Missing atomic undo safety wrapper; wrap scene operations in `api.startUndo("..."); try { ... } finally { api.endUndo(); }`.',
    })
  }

  let primitiveDeduction = 0
  const rawApiCallRegex = /\bapi\.(create|set)\s*\(/g
  for (let i = 0; i < maskedLines.length; i++) {
    const lineText = maskedLines[i]
    let match
    rawApiCallRegex.lastIndex = 0
    while ((match = rawApiCallRegex.exec(lineText)) !== null) {
      const deducted = primitiveDeduction < 30 ? Math.min(5, 30 - primitiveDeduction) : 0
      primitiveDeduction = Math.min(30, primitiveDeduction + 5)
      const lineNum = i + 1
      const method = match[1]
      const replacementHint =
        method === 'create'
          ? '_mg.shape(), _mg.text(), or _mg.layer()'
          : '_mg.set(layerId, attrs)'
      violations.push({
        rule: 'mg_primitive_purity',
        line: lineNum,
        pointsDeducted: deducted,
        snippet: (rawLines[i] ?? '').trim(),
        message: `Line ${lineNum}: Replace raw \`api.${method}(\` with \`${replacementHint}\`.`,
      })
    }
  }

  let stylingDeduction = 0
  const hexLiteralRegex = /(?<![A-Za-z0-9_])#[0-9A-Fa-f]{6}\b/g
  for (let i = 0; i < maskedLines.length; i++) {
    const lineText = maskedLines[i]
    if (/\b_mg\.applySceneTheme\s*\(/.test(lineText)) {
      continue
    }
    let match
    hexLiteralRegex.lastIndex = 0
    while ((match = hexLiteralRegex.exec(lineText)) !== null) {
      const hexLiteral = match[0]
      const deducted = stylingDeduction < 25 ? Math.min(5, 25 - stylingDeduction) : 0
      stylingDeduction = Math.min(25, stylingDeduction + 5)
      const lineNum = i + 1
      violations.push({
        rule: 'tokenized_styling',
        line: lineNum,
        pointsDeducted: deducted,
        snippet: (rawLines[i] ?? '').trim(),
        message: `Line ${lineNum}: Replace hardcoded hex literal \`${hexLiteral}\` with an \`_mg.theme.*\` token (e.g. \`_mg.theme.cardFill\`, \`_mg.theme.textPrimary\`, \`_mg.theme.accentPrimary\`).`,
      })
    }
  }

  let motionDeduction = 0
  const keyframeLoopRegex =
    /\b(?:for|while)\s*\([^)]*\)\s*\{[\s\S]*?\b(?:api\.keyframe|_mg\.keyframe)\s*\([\s\S]*?\}/g
  let loopMatch
  while ((loopMatch = keyframeLoopRegex.exec(masked)) !== null) {
    const prefix = masked.slice(0, loopMatch.index)
    const lineNum = prefix.split(/\r?\n/).length
    const deducted = motionDeduction < 20 ? Math.min(10, 20 - motionDeduction) : 0
    motionDeduction = Math.min(20, motionDeduction + 10)
    violations.push({
      rule: 'procedural_motion_purity',
      line: lineNum,
      pointsDeducted: deducted,
      snippet: (rawLines[lineNum - 1] ?? '').trim(),
      message: `Line ${lineNum}: Replace frame-by-frame keyframe loop with procedural \`_mg.spring()\`, \`_mg.modulate()\`, or \`_mg.stagger()\`.`,
    })
  }

  const totalDeduction = undoDeduction + primitiveDeduction + stylingDeduction + motionDeduction
  const score = Math.max(0, 100 - totalDeduction)
  const grade = gradeFromScore(score)
  const passed = score >= 75

  let autoFixPrompt = ''
  if (!passed || violations.length > 0) {
    const instructions = violations.map((v) => v.message).join(' ')
    autoFixPrompt = `Refactor this Cavalry script to achieve Grade A _mg purity (current score: ${score}/100, grade: ${grade}): call _mg.applySceneTheme("neutral") inside an atomic api.startUndo(...) / try { ... } finally { api.endUndo(); } block and apply these exact line fixes: ${instructions}`
  }

  return {
    score,
    grade,
    passed,
    breakdown: {
      atomicUndoSafety: 25 - undoDeduction,
      mgPrimitivePurity: 30 - primitiveDeduction,
      tokenizedStyling: 25 - stylingDeduction,
      proceduralMotionPurity: 20 - motionDeduction,
    },
    violations,
    autoFixPrompt,
  }
}

export function injectSceneThemeInsideUndo(scriptString, themeName = 'neutral') {
  const raw = String(scriptString ?? '')
  const safeTheme = typeof themeName === 'string' && themeName.trim() ? themeName.trim().toLowerCase() : 'neutral'
  const hasThemeCall = /\b_mg\.applySceneTheme\s*\(/.test(raw)

  if (hasThemeCall) {
    return raw
  }

  const themeStmt = `_mg.applySceneTheme(${JSON.stringify(safeTheme)});`

  // Case 1: Has try { ... } after api.startUndo
  if (/\bapi\.startUndo(?:Group)?\s*\(/.test(raw) && /\btry\s*\{/.test(raw)) {
    return raw.replace(/\btry\s*\{/, `try {\n  ${themeStmt}`)
  }

  // Case 2: Has _mg.undoGroup({ ... operations: () => { ... } })
  if (/\b_mg\.undoGroup\s*\(/.test(raw) && /\boperations\s*:\s*\(\s*\)\s*=>\s*\{/.test(raw)) {
    return raw.replace(
      /\boperations\s*:\s*\(\s*\)\s*=>\s*\{/,
      `operations: () => {\n    ${themeStmt}`,
    )
  }

  // Case 3: No undo wrapper yet — wrap in atomic api.startUndo / try / finally / api.endUndo
  return `api.startUndo("Stallion Scene Execution");\ntry {\n  ${themeStmt}\n${raw}\n} finally {\n  api.endUndo();\n}`
}

export default validateMgPurity
