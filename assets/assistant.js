(() => {
  'use strict';

  window.createAtlasAssistant = (client, getUser, openAgency) => {
    const byId = (id) => document.getElementById(id);
    const log = byId('assistant-log');
    const form = byId('assistant-form');
    const input = byId('assistant-question');
    const submit = byId('assistant-submit');
    const status = byId('assistant-status');
    let recent = [];
    let summary = '';
    let active;

    function reset() {
      active?.abort();
      active = undefined;
      recent = [];
      summary = '';
      log.replaceChildren();
      input.value = '';
      submit.disabled = false;
      status.textContent = '';
    }

    function element(tag, text, parent) {
      const node = document.createElement(tag);
      node.textContent = text;
      parent.append(node);
      return node;
    }

    function message(author, text) {
      const article = element('article', '', log);
      article.className = 'assistant-message';
      element('strong', author, article);
      element('p', text, article);
      return article;
    }

    function showEvidence(article, groups) {
      for (const group of groups) {
        const section = element('details', '', article);
        const count = group.total == null ? '' : ' · ' + group.total + ' matches';
        const more = group.hasMore ? ' · more available' : '';
        element('summary', '[' + group.ref + '] ' + group.query.mode + count + more, section);
        const filters = Object.entries(group.query).filter(([key]) => key !== 'mode');
        if (filters.length) element('p', filters.map(([key, value]) => key + ' = ' + value).join(' · '), section);
        for (const row of group.rows) {
          const record = element('details', '', section);
          element('summary', '[' + row.ref + '] ' + (row.name || row.display_name || 'Record') +
            (row.ori ? ' · ' + row.ori : ''), record);
          if (row.ori) {
            const button = element('button', 'Open agency', record);
            button.type = 'button';
            button.className = 'button outline small';
            button.addEventListener('click', () => openAgency(row.ori));
          }
          const facts = element('dl', '', record);
          for (const [key, value] of Object.entries(row)) {
            if (key === 'ref' || value == null || value === '') continue;
            element('dt', key.replaceAll('_', ' '), facts);
            element('dd', String(value), facts);
          }
        }
      }
    }

    async function ask(event) {
      event.preventDefault();
      const question = input.value.trim();
      const userId = getUser()?.id;
      if (!question || active || !userId) return;

      const controller = new AbortController();
      active = controller;
      submit.disabled = true;
      status.textContent = 'Checking Atlas records…';
      const pending = message('You', question);
      input.value = '';
      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error || session?.user.id !== userId) throw new Error('Sign in again to use the assistant.');
        if (active !== controller) return;
        const result = await client.functions.invoke('atlas-assistant', {
          body: { question, recent, summary },
          headers: { Authorization: 'Bearer ' + session.access_token },
          signal: controller.signal,
        });
        if (result.error) {
          const response = result.error.context;
          const info = await response?.json?.().catch(() => null);
          if (info?.code) {
            throw new Error(info.error + ' [' + info.code + ' · Request ' + info.requestId + ']');
          }
          if (response?.status) {
            const reason = {
              401: 'Check the function’s legacy JWT setting and sign in again.',
              404: 'Check that atlas-assistant is deployed in the Supabase project used by this site.',
              546: 'Check the function logs for a runtime limit.',
            }[response.status] || 'Check the Edge Function deployment and logs in Supabase.';
            throw new Error('Supabase returned HTTP ' + response.status + '. ' + reason +
              ' [ATLAS_GATEWAY_' + response.status + ']');
          }
          throw new Error('The browser could not read a response. Check the allowed site origin, function URL, and Network tab. [ATLAS_BROWSER_FETCH]');
        }
        if (active !== controller || getUser()?.id !== userId) return;
        const article = message('Atlas assistant', result.data.answer);
        showEvidence(article, result.data.evidence);
        recent = [...recent.slice(-1), { question: question.slice(0, 500), answer: result.data.answer.slice(0, 800) }];
        summary = result.data.summary;
        status.textContent = 'Answer ready.';
      } catch (error) {
        if (active !== controller) return;
        pending.remove();
        if (!input.value) input.value = question;
        status.textContent = error.message;
      } finally {
        if (active === controller) {
          active = undefined;
          submit.disabled = false;
          log.scrollTop = log.scrollHeight;
        }
      }
    }

    form.addEventListener('submit', ask);
    byId('assistant-clear').addEventListener('click', reset);
    byId('assistant-examples').addEventListener('click', (event) => {
      const example = event.target.closest('button');
      if (!example) return;
      input.value = example.textContent;
      input.focus();
    });
    client.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') reset(); });
    return { reset };
  };
})();
