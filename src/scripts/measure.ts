import { fs, chalk, sleep } from 'zx';
import { getFrameworks } from '../helpers/get-frameworks.js';
import { getJsSize } from '../helpers/get-js-size.js';
import {
  getLighthouseReport,
  teardownBrowser,
} from '../helpers/get-lighthouse-report.js';
import { killAll } from '../helpers/kill-process.js';
import { preview } from '../helpers/preview.js';
import { sortBy } from '../helpers/sort-by.js';

const frameworks = await getFrameworks();

const path = process.env.URL || '/todo';

// Kill any currently running servers
await killAll(frameworks);

export type Measurement = {
  jsKb?: number;
  fcpDisplay?: string;
  fcpNumber?: number;
  tbtDisplay?: string;
  tbtNumber?: number;
  ttiDisplay?: string;
  ttiNumber?: number;
  lcpDisplay?: string;
  lcpNumber?: number;
};

const PARALLEL = process.env.PARALLEL ? process.env.PARALLEL === 'true' : false;

const results: Record<string, Measurement> = {};

if (PARALLEL) {
  await Promise.all(frameworks.map(measure));
} else {
  for (const framework of frameworks) {
    await measure(framework);
  }
}

await teardownBrowser();

console.info(chalk.green('Done!'));
console.table(getTable(results));

async function measure(framework: string) {
  const { process: runningProcess, port } = await preview(framework);
  // Give the server a sec to start up
  await sleep(2000);

  const measureUrl = `http://localhost:${port}${path}`;
  console.info(
    `Getting lighthouse report for ${chalk.green(framework)} on ${measureUrl}`
  );
  const report = await getLighthouseReport(measureUrl);
  const jsSize = getJsSize(report);
  const fcp = report.audits['first-contentful-paint'];
  const lcp = report.audits['largest-contentful-paint'];
  const tbt = report.audits['total-blocking-time'];
  const tti = report.audits['interactive'];

  results[framework] = {
    jsKb: jsSize,
    fcpDisplay: fcp?.displayValue,
    fcpNumber: fcp?.numericValue,
    tbtDisplay: tbt?.displayValue,
    tbtNumber: tbt?.numericValue,
    ttiDisplay: tti?.displayValue,
    ttiNumber: tti?.numericValue,
    lcpDisplay: lcp?.displayValue,
    lcpNumber: lcp?.numericValue,
  };
  console.info(chalk.green(`${framework}:`, jsSize + 'kb'));

  fs.writeFile('report.json', JSON.stringify(report, null, 2));

  // Don't throw an error when we kill the process below
  runningProcess.catch(() => null);
  runningProcess.kill();
}

function getTable(results: Record<string, Measurement>) {
  const table = Object.keys(results)
    // Add the framework name to the object
    .map((framework) => ({
      name: framework,
      ...results[framework],
    }))
    // Only include successful results (failed results have undefined values)
    .filter((item) => typeof item.jsKb === 'number')
    // Rank by tti
    .sort(sortBy('ttiNumber'))
    // Pick the display values
    .map((item) => ({
      name: item.name,
      TTI: item.ttiDisplay,
      'JS kb': item.jsKb,
      FCP: item.fcpDisplay,
      TBT: item.tbtDisplay,
      LCP: item.lcpDisplay,
    }));

  return table;
}
