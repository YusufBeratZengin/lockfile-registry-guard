'use strict';

const { RULES } = require('../validator');

/** Homepage used for rule help links. */
const HELP_URI = 'https://github.com/YusufBeratZengin/lockfile-registry-guard#rules';

/**
 * Build the SARIF 2.1.0 document for a run.
 *
 * GitHub only renders results as annotations when `version`, `runs[].tool`
 * and `locations[].physicalLocation.region.startLine` are all present, so the
 * line numbers kept by the parsers are what makes the inline PR comments work.
 * @param {import('./index').Report} report Run report.
 * @returns {string} SARIF JSON with a trailing newline.
 */
function formatSarif(report) {
  /** @type {Map<string, Object>} */
  const usedRules = new Map();
  for (const item of report.violations) {
    if (usedRules.has(item.code)) continue;
    const definition = RULES[item.code] || { title: item.code, description: item.code };
    usedRules.set(item.code, {
      id: item.code,
      name: item.code,
      shortDescription: { text: definition.title },
      fullDescription: { text: definition.description },
      helpUri: HELP_URI + '-' + item.code.toLowerCase().replace(/_/g, '-'),
      defaultConfiguration: { level: item.severity === 'warning' ? 'warning' : 'error' },
    });
  }

  const results = report.violations.map((item) => ({
    ruleId: item.code,
    ruleIndex: Array.from(usedRules.keys()).indexOf(item.code),
    level: item.severity === 'warning' ? 'warning' : 'error',
    message: { text: item.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: item.file },
          region: { startLine: item.line > 0 ? item.line : 1, startColumn: 1 },
        },
      },
    ],
    properties: {
      package: item.name,
      version: item.version,
      resolved: item.url,
      expected: item.expected,
    },
  }));

  const document = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: 'https://github.com/YusufBeratZengin/lockfile-registry-guard',
            rules: Array.from(usedRules.values()),
          },
        },
        columnKind: 'utf16CodeUnits',
        results: results,
      },
    ],
  };
  return JSON.stringify(document, null, 2) + '\n';
}

module.exports = { formatSarif, HELP_URI };
