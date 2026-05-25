/**
 * Tiny, safe Markdown renderer scoped to what the query-router explanation
 * strings actually emit: paragraphs, **bold**, *italic*, `code`,
 * `-` bullet lists, and pipe-tables. Output is React elements, not
 * dangerouslySetInnerHTML — no XSS surface.
 *
 * This deliberately is **not** a general Markdown engine.
 */

import { Fragment, type ReactNode } from "react";

/** Inline pass — handles `code`, **bold**, *italic*. */
function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let nodeKey = 0;

  const push = (node: ReactNode) => {
    if (buffer) {
      out.push(<Fragment key={`${keyPrefix}-t-${nodeKey++}`}>{buffer}</Fragment>);
      buffer = "";
    }
    out.push(node);
  };

  while (i < line.length) {
    const c = line[i];
    // `code`
    if (c === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > i) {
        push(
          <code key={`${keyPrefix}-c-${nodeKey++}`} className="ms-ask-md__code">
            {line.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    // **bold**
    if (c === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > i + 1) {
        push(
          <strong key={`${keyPrefix}-b-${nodeKey++}`}>
            {line.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // *italic* — single asterisk, not preceded by a letter (avoid mid-word)
    if (c === "*" && line[i + 1] !== "*") {
      const end = line.indexOf("*", i + 1);
      if (end > i) {
        push(
          <em key={`${keyPrefix}-i-${nodeKey++}`}>
            {line.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    // _italic_
    if (c === "_") {
      const end = line.indexOf("_", i + 1);
      if (end > i && /\s|\W/.test(line[end + 1] ?? " ")) {
        push(
          <em key={`${keyPrefix}-u-${nodeKey++}`}>
            {line.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    buffer += c;
    i++;
  }
  if (buffer) {
    out.push(<Fragment key={`${keyPrefix}-t-${nodeKey++}`}>{buffer}</Fragment>);
  }
  return out;
}

/** Top-level block parser for query-router output. */
export function Markdown({ source }: { source: string }): ReactNode {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line — paragraph separator.
    if (trimmed === "") {
      i++;
      continue;
    }

    // Heading: `# h1`, `## h2`, `### h3`.
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const inline = renderInline(text, `md-${key}`);
      const klass = `ms-ask-md__h${level}`;
      const k = `md-${key++}`;
      if (level === 1) blocks.push(<h1 key={k} className={klass}>{inline}</h1>);
      else if (level === 2) blocks.push(<h2 key={k} className={klass}>{inline}</h2>);
      else blocks.push(<h3 key={k} className={klass}>{inline}</h3>);
      i++;
      continue;
    }

    // Pipe-table: header line, separator line, body rows. Detect by
    // looking ahead for `| --- | --- |` next.
    if (trimmed.startsWith("|") && lines[i + 1]?.trim().match(/^\|[-: |]+\|$/)) {
      const headerCells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        bodyRows.push(
          lines[j].trim().split("|").slice(1, -1).map((c) => c.trim()),
        );
        j++;
      }
      blocks.push(
        <table key={`md-${key++}`} className="ms-ask-md__table">
          <thead>
            <tr>
              {headerCells.map((h, hi) => (
                <th key={hi}>{renderInline(h, `mdh-${key}-${hi}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{renderInline(cell, `mdc-${key}-${ri}-${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      i = j;
      continue;
    }

    // Bulleted list — collect contiguous `- ` lines.
    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={`md-${key++}`} className="ms-ask-md__list">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `mdl-${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Default — paragraph.
    blocks.push(
      <p key={`md-${key++}`} className="ms-ask-md__p">
        {renderInline(line, `mdp-${key}`)}
      </p>,
    );
    i++;
  }

  return <div className="ms-ask-md">{blocks}</div>;
}
