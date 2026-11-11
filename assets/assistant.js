(() => {
  'use strict';

  window.createAtlasAssistant = (client, getUser, { openAgency, openState, openTeam }) => {
    const byId = (id) => document.getElementById(id);
    const log = byId('assistant-log');
    const form = byId('assistant-form');
    const input = byId('assistant-question');
    const submit = byId('assistant-submit');
    const status = byId('assistant-status');
    let recent = [];
    let summary = '';
    let active;
    let agency;
    const scope = byId('assistant-scope');
    const examples = byId('assistant-examples');

    function setAgency(record) {
      agency = record;
      scope.classList.toggle('hidden', !record);
      examples.classList.toggle('hidden', !!record);
      byId('assistant-scope-name').textContent = record ? record.name + ' · ' + record.ori : '';
    }

    function reset() {
      active?.abort();
      active = undefined;
      recent = [];
      summary = '';
      setAgency();
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

    function action(parent, label, run) {
      const button = element('button', label, parent);
      button.type = 'button';
      button.className = 'button outline small';
      button.addEventListener('click', run);
    }

    function rankingSummary(group) {
      if (!group.rows.length) return 'No eligible agencies matched this search.';
      const first = group.rows[0];
      const tied = group.rows.length > 1 && group.rows.every((row) =>
        row.priority === first.priority && row.followup === first.followup &&
        row.saved_channels === first.saved_channels);
      if (tied) {
        return 'These agencies tie on outreach priority, follow-up date, and saved contact channels. ' +
          'Atlas lists them alphabetically. Use a state or county to narrow the list.';
      }
      return 'Atlas orders these agencies by follow-up urgency, outreach status, and available contact channels.';
    }

    function showEvidence(article, groups) {
      const labels = { rank: 'Next contacts', followups: 'Follow-ups', search: 'Agency results',
        team: 'Team outreach', activity: 'Activity', attribution: 'Outreach attribution', count: 'Agency count' };
      const priorities = { 100: 'Follow-up due', 60: 'Active conversation', 40: 'First contact',
        20: 'Ready for another attempt', 0: 'Eligible for outreach' };
      for (const group of groups) {
        const section = element('section', '', article);
        section.className = 'assistant-results';
        const count = group.total == null ? '' : ' · ' + group.total.toLocaleString() + ' matches';
        element('h3', (labels[group.query.mode] || group.query.mode) + count, section);
        if (group.hasMore) element('small', 'Showing ' + group.rows.length + ' results. Ask for the next page.', section);
        const filters = Object.entries(group.query).filter(([key]) => key !== 'mode');
        if (filters.length) {
          const details = element('details', '', section);
          element('summary', 'Query filters [' + group.ref + ']', details);
          element('p', filters.map(([key, value]) => key + ' = ' + value).join(' · '), details);
        }
        if (group.query.mode === 'team') action(section, 'Open Team performance', openTeam);
        const grid = element('div', '', section);
        grid.className = 'assistant-result-grid';
        for (const row of group.rows) {
          const card = element('article', '', grid);
          card.className = 'assistant-result-card';
          element('h4', row.name || row.display_name || 'Record', card);
          if (row.ori) {
            element('small', [row.county && row.county + ' County', row.state, row.ori].filter(Boolean).join(' · '), card);
            const highlights = [
              priorities[row.priority], row.status, row.followup && 'Follow-up ' + row.followup,
              row.saved_channels === 0 ? 'No saved contact channels' :
                row.saved_channels > 0 ? row.saved_channels + ' saved contact channels' : '',
              row.method && row.method.replaceAll('_', ' '), row.actor,
            ].filter(Boolean);
            if (highlights.length) element('p', highlights.join(' · '), card);
            const actions = element('div', '', card);
            actions.className = 'assistant-card-actions';
            action(actions, 'Open agency', () => openAgency(row.ori));
        if (['rank', 'search', 'followups'].includes(group.query.mode)) {
          action(actions, 'Set follow-up', () => openAgency(row.ori, { focusFollowup: true }));
        }
            if (row.state) action(actions, 'Browse ' + row.state + ' agencies', () => openState(row.state));
          } else if (row.attempts != null) {
            element('p', row.attempts + ' attempts · ' + row.unique_agencies + ' unique agencies', card);
            element('small', row.calls + ' calls · ' + row.emails + ' emails · ' + row.linkedin + ' LinkedIn', card);
          }
          const details = element('details', '', card);
          element('summary', 'Source fields [' + row.ref + ']', details);
          const facts = element('dl', '', details);
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
          body: { question, recent, summary, agencyOri: agency?.ori },
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
        const groups = result.data.evidence;
        const rankOnly = groups.length === 1 && groups[0].query.mode === 'rank';
        const article = message('Atlas assistant', rankOnly ? rankingSummary(groups[0]) : result.data.answer);
        showEvidence(article, groups);
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
    byId('assistant-scope-clear').addEventListener('click', reset);
    return {
      reset,
      focusAgency(record) {
        reset();
        setAgency(record);
        input.value = 'What outreach has already happened here, and what should we do next?';
        input.focus();
      },
    };
  };
})();
