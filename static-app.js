/* Offline-query adapter for the published, read-only HS demo. */
(function (root) {
  'use strict';
  const norm = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const codeKey = value => String(value || '').replace(/\D/g, '');
  const tokens = value => norm(value).match(/[a-z0-9]+/g) || [];
  const stops = new Set(['la', 'cua', 'va', 'cho', 'voi', 'nhung', 'loai', 'mot', 'cac', 'duoc', 'trong']);
  let catalogPromise;
  async function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('./catalog.json').then(response => {
        if (!response.ok) throw new Error('Không tải được bộ dữ liệu demo');
        return response.json();
      }).then(data => {
        if (!Array.isArray(data.records) || data.records.length < 10000) throw new Error('Bộ dữ liệu không đầy đủ');
        data.byCode = new Map();
        for (const item of data.records) {
          item.code_key = codeKey(item.code);
          item.search_vi = norm(item.description_vi);
          item.search_en = norm(item.description_en);
          item.source_url = data.sources[item.code_key.slice(0, 2)] || '';
          item.source = 'ITPC · Biểu thuế 2026';
          item.snapshot_date = data.snapshot_date;
          item.is_current = true;
          data.byCode.set(item.code_key, item);
        }
        return data;
      }).catch(error => { catalogPromise = null; throw error; });
    }
    return catalogPromise;
  }
  function query(data, text, limit = 20) {
    const raw = String(text || '').trim();
    if (!raw) return { mode: 'knowledge', results: [], web_search_used: false };
    if (/^[\d.\s]+$/.test(raw) && codeKey(raw).length >= 4 && codeKey(raw).length <= 12) {
      const key = codeKey(raw);
      if (key.length >= 8 && data.byCode.has(key))
        return { mode: 'exact', results: [data.byCode.get(key)], web_search_used: false };
      const results = data.records.filter(item => item.code_key.startsWith(key)).slice(0, limit);
      return { mode: 'exact_prefix', results, web_search_used: false };
    }
    const words = tokens(raw).filter(word => word.length > 1 && !stops.has(word));
    if (!words.length) return { mode: 'knowledge', results: [], web_search_used: false };
    const phrase = words.join(' ');
    const matches = [];
    for (const item of data.records) {
      const vi = item.search_vi;
      const en = item.search_en;
      const all = vi + ' ' + en;
      if (!words.every(word => all.includes(word))) continue;
      const leaf = vi.split(' — ').pop() || vi;
      let score = words.filter(word => leaf.includes(word)).length * 4;
      if (leaf.includes(phrase)) score += 12;
      if (vi.includes(phrase)) score += 3;
      if (item.code_key.length === 8) score += 2;
      if (item.tariff_rates && Object.keys(item.tariff_rates).length) score += 1;
      matches.push({ item, score });
    }
    matches.sort((a,b) => b.score - a.score || a.item.code_key.localeCompare(b.item.code_key));
    return { mode: 'knowledge', results: matches.slice(0, limit).map(match => match.item), web_search_used: false };
  }
  const adapter = {
    async fetch(path, options) {
      const data = await catalog();
      const payload = path === '/health'
        ? { status: 'ok', current_codes: data.records.length, versions: data.records.length, web_search_enabled: false }
        : query(data, JSON.parse(options.body).query, JSON.parse(options.body).limit || 20);
      return { ok: true, json: async () => payload };
    }
  };
  root.HS_STATIC_ADAPTER = adapter;
  if (typeof module !== 'undefined') module.exports = { query, norm, codeKey, tokens };
})(typeof window !== 'undefined' ? window : globalThis);
