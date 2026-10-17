#!/usr/bin/env node
// Draws the profile's stats as SVG with the portfolio's palette, so the README never
// depends on a third-party service. Everything is fetched first and written last: if the
// API fails, the SVGs already in the repo are left as they are and the profile keeps
// showing the last good ones.
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/stats.mjs
//   STATS_FIXTURE=stats.json STATS_OUT=/tmp/preview node scripts/stats.mjs   # design preview, no API
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = process.env.STATS_USER || 'gt2rz';
const OUT = process.env.STATS_OUT || join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'stats');

const C = {
	bg: '#0b0b0d',
	ink: '#e8e8ea',
	muted: '#8a8a90',
	red: '#f04a1a',
	lime: '#c6f432',
	strip: '#333',
};
// The languages' tones, most used first.
const TONES = [C.red, C.lime, C.ink, C.muted, '#5a5a60', C.strip];

function token() {
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	try {
		return execSync('gh auth token', { encoding: 'utf8' }).trim();
	} catch {
		throw new Error('Sin token: define GITHUB_TOKEN o inicia sesión con `gh auth login`.');
	}
}

const QUERY = `
query ($login: String!, $after: String) {
	user(login: $login) {
		repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100, after: $after) {
			totalCount
			pageInfo { hasNextPage endCursor }
			nodes {
				stargazerCount
				languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
			}
		}
		contributionsCollection {
			contributionCalendar {
				totalContributions
				weeks { contributionDays { date contributionCount } }
			}
		}
	}
}`;

async function graphql(variables) {
	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: { Authorization: `bearer ${token()}`, 'Content-Type': 'application/json', 'User-Agent': 'gt2rz-stats' },
		body: JSON.stringify({ query: QUERY, variables }),
	});
	if (!response.ok) throw new Error(`GitHub respondió ${response.status} ${response.statusText}`);
	const { data, errors } = await response.json();
	if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
	if (!data?.user) throw new Error(`No existe el usuario ${LOGIN}`);
	return data.user;
}

async function fetchStats() {
	const repos = [];
	let after = null;
	let user;
	do {
		user = await graphql({ login: LOGIN, after });
		repos.push(...user.repositories.nodes);
		after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
	} while (after);

	const calendar = user.contributionsCollection.contributionCalendar;
	const days = calendar.weeks.flatMap((week) => week.contributionDays);

	const bytes = new Map();
	repos.forEach((repo) =>
		repo.languages.edges.forEach(({ size, node }) => bytes.set(node.name, (bytes.get(node.name) ?? 0) + size)),
	);

	return {
		contributions: calendar.totalContributions,
		repos: user.repositories.totalCount,
		stars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
		...streaks(days),
		weeks: calendar.weeks.slice(-12).map((week) => week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0)),
		languages: [...bytes].sort((a, b) => b[1] - a[1]),
	};
}

/** The current streak counts today only once there is something in it: the day is not over. */
function streaks(days) {
	let longest = 0;
	let run = 0;
	days.forEach((day) => {
		run = day.contributionCount > 0 ? run + 1 : 0;
		longest = Math.max(longest, run);
	});
	let current = 0;
	let index = days.length - 1;
	if (index >= 0 && days[index].contributionCount === 0) index--;
	for (; index >= 0 && days[index].contributionCount > 0; index--) current++;
	return { current, longest };
}

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString('es-ES');
const today = () => new Date().toISOString().slice(0, 10);

function frame(label, right, body, desc) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200" role="img" aria-label="${esc(desc)}">
	<style>
		.display { font-family: 'Arial Black', 'Helvetica Neue', Impact, system-ui, sans-serif; font-weight: 900; }
		.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
		.grow { transform-box: fill-box; transform-origin: 50% 100%; animation: grow .9s cubic-bezier(.2, .7, .2, 1) both; }
		.fill { transform-box: fill-box; transform-origin: 0 50%; animation: fill 1.1s cubic-bezier(.2, .7, .2, 1) both; }
		@keyframes grow { from { transform: scaleY(0); } }
		@keyframes fill { from { transform: scaleX(0); } }
		@media (prefers-reduced-motion: reduce) { .grow, .fill { animation: none; } }
	</style>
	<rect width="600" height="200" fill="${C.bg}" />
	<rect x=".5" y=".5" width="599" height="199" fill="none" stroke="#ffffff" stroke-opacity=".12" />
	<path d="M12 6v12M6 12h12M588 6v12M582 12h12M12 182v12M6 188h12M588 182v12M582 188h12" stroke="${C.ink}" stroke-opacity=".5" />
	<text class="mono" x="32" y="40" font-size="12" letter-spacing="1.5" fill="${C.red}">${esc(label)}</text>
	<text class="mono" x="568" y="40" font-size="11" letter-spacing="1" fill="${C.muted}" text-anchor="end">${esc(right)}</text>
${body}
</svg>
`;
}

function overview(stats) {
	const metrics = [
		['CONTRIBUCIONES', fmt(stats.contributions)],
		['RACHA ACTUAL', `${stats.current}d`],
		['RACHA MÁX.', `${stats.longest}d`],
		['REPOS · ★', `${stats.repos} · ${stats.stars}`],
	];
	const cells = metrics
		.map(
			([name, value], i) => `	<text class="display" x="${32 + i * 136}" y="98" font-size="30" fill="${C.ink}">${esc(value)}</text>
	<text class="mono" x="${32 + i * 136}" y="118" font-size="10" letter-spacing="1" fill="${C.muted}">${esc(name)}</text>`,
		)
		.join('\n');
	// The last twelve weeks, as a row of bars on a rail; the busiest one in lime.
	const peak = Math.max(1, ...stats.weeks);
	const bars = stats.weeks
		.map((count, i) => {
			const h = Math.max(2, Math.round((count / peak) * 34));
			const fill = count === peak && count > 0 ? C.lime : count > 0 ? C.ink : C.strip;
			return `		<rect class="grow" style="animation-delay:${i * 40}ms" x="${32 + i * 45}" y="${172 - h}" width="33" height="${h}" fill="${fill}" fill-opacity="${fill === C.ink ? 0.55 : 1}" />`;
		})
		.join('\n');
	const body = `${cells}
	<g>
${bars}
	</g>
	<line x1="32" y1="174" x2="568" y2="174" stroke="${C.ink}" stroke-opacity=".35" />
	<text class="mono" x="568" y="190" font-size="9" letter-spacing="1" fill="${C.muted}" text-anchor="end">ÚLTIMAS 12 SEMANAS · ${today()}</text>`;
	return frame(
		'STATS / ÚLTIMO AÑO',
		`@${LOGIN}`,
		body,
		`${stats.contributions} contribuciones en el último año, racha actual de ${stats.current} días, máxima de ${stats.longest}, ${stats.repos} repositorios públicos y ${stats.stars} estrellas`,
	);
}

function languages(stats) {
	const top = stats.languages.slice(0, 5);
	const rest = stats.languages.slice(5).reduce((sum, [, size]) => sum + size, 0);
	if (rest > 0) top.push(['Otros', rest]);
	const total = top.reduce((sum, [, size]) => sum + size, 0) || 1;
	let x = 32;
	const segments = top
		.map(([, size], i) => {
			const w = (size / total) * 536;
			const rect = `		<rect x="${x.toFixed(1)}" y="64" width="${Math.max(0, w - 2).toFixed(1)}" height="14" fill="${TONES[i]}" />`;
			x += w;
			return rect;
		})
		.join('\n');
	const legend = top
		.map(([name, size], i) => {
			const cx = 32 + (i % 2) * 272;
			const cy = 112 + Math.floor(i / 2) * 26;
			return `	<rect x="${cx}" y="${cy - 10}" width="10" height="10" fill="${TONES[i]}" stroke="${C.ink}" stroke-opacity="${TONES[i] === C.strip ? 0.4 : 0}" />
	<text class="mono" x="${cx + 20}" y="${cy}" font-size="13" fill="${C.ink}">${esc(name)}</text>
	<text class="mono" x="${cx + 236}" y="${cy}" font-size="13" fill="${C.muted}" text-anchor="end">${((size / total) * 100).toFixed(1)}%</text>`;
		})
		.join('\n');
	const body = `	<g class="fill">
${segments}
	</g>
${legend || `	<text class="mono" x="32" y="112" font-size="13" fill="${C.muted}">Sin repositorios públicos con código todavía.</text>`}`;
	return frame(
		'LENGUAJES / REPOS PÚBLICOS',
		`ACTUALIZADO ${today()}`,
		body,
		`Lenguajes más usados: ${top.map(([name, size]) => `${name} ${((size / total) * 100).toFixed(1)}%`).join(', ')}`,
	);
}

try {
	const stats = process.env.STATS_FIXTURE
		? JSON.parse(readFileSync(process.env.STATS_FIXTURE, 'utf8'))
		: await fetchStats();
	const files = { 'overview.svg': overview(stats), 'languages.svg': languages(stats) };
	mkdirSync(OUT, { recursive: true });
	Object.entries(files).forEach(([name, svg]) => writeFileSync(join(OUT, name), svg));
	console.log(`stats: ${stats.contributions} contribuciones, ${stats.repos} repos, ${stats.languages.length} lenguajes`);
} catch (error) {
	console.error(`stats: no se actualizaron (${error.message}); se conservan las SVG anteriores.`);
	process.exit(1);
}
