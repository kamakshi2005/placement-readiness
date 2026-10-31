// Skill name clean-up, applied before any matching.
// "React.JS " -> "react.js" -> alias -> "react". Exact matches after this step need no AI at all.

// Keys and values are already normalized (lowercase, single spaces).
export const ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  node: 'node.js',
  nodejs: 'node.js',
  'node js': 'node.js',
  reactjs: 'react',
  'react.js': 'react',
  'react js': 'react',
  vuejs: 'vue',
  'vue.js': 'vue',
  angularjs: 'angular',
  express: 'express.js',
  expressjs: 'express.js',
  'express js': 'express.js',
  'next js': 'next.js',
  nextjs: 'next.js',
  mongo: 'mongodb',
  postgres: 'postgresql',
  mysql8: 'mysql',
  py: 'python',
  python3: 'python',
  golang: 'go',
  cpp: 'c++',
  csharp: 'c#',
  ml: 'machine learning',
  dl: 'deep learning',
  ai: 'artificial intelligence',
  nlp: 'natural language processing',
  cv: 'computer vision',
  oop: 'object-oriented programming',
  oops: 'object-oriented programming',
  'object oriented programming': 'object-oriented programming',
  dsa: 'data structures and algorithms',
  'data structures': 'data structures and algorithms',
  dbms: 'database management systems',
  rdbms: 'relational databases',
  rest: 'rest api',
  'rest apis': 'rest api',
  'restful api': 'rest api',
  'restful apis': 'rest api',
  html5: 'html',
  css3: 'css',
  k8s: 'kubernetes',
  gcp: 'google cloud',
  'google cloud platform': 'google cloud',
  'amazon web services': 'aws',
  'ci/cd pipelines': 'ci/cd',
  cicd: 'ci/cd',
  'git/github': 'git',
  github: 'git',
};

/** lowercase, trim, collapse spaces, strip trailing punctuation */
export function normalizeSkill(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-–•]+|[\s,;:\-–•]+$/g, '') // keep a trailing "." only inside names like "node.js"
    .replace(/\.$/, '')
    .trim();
}

/** normalized + alias-resolved name used for exact matching and embeddings */
export function canonicalSkill(raw) {
  const n = normalizeSkill(raw);
  return ALIASES[n] || n;
}
