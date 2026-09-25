/* ============================================================
   LOGIC — AI 브레인 (프로토타입 = 휴리스틱 엔진)
   실제 배포 시 자연어 피드백 → GPT 파이프라인으로 교체.
   여기서는 "되돌리기 가능한 규칙" + "후보 제안"으로 동작.
   ============================================================ */
(function (global) {
  'use strict';

  const L = {};

  /* ---------- 레이아웃 : 위젯 3개 그리드 (AI가 균형만 관리) ---------- */
  const LAYOUTS = {
    'today-hero': { label:'오늘 중심', desc:'좌측 큰 ‘오늘 일정’ + 우측 관심사·브리핑', a:'today' },
    'topics-hero':{ label:'관심사 중심', desc:'좌측 큰 ‘관심사 카드’ + 우측 오늘·브리핑', a:'topics' },
    'news-hero':  { label:'브리핑 중심', desc:'좌측 큰 ‘Today’s Briefing’ + 우측 오늘·관심사', a:'news' },
    'equal':      { label:'균등 3분할', desc:'세 위젯을 같은 크기로 나란히', a:'today' },
  };
  function decideLayout(topicCount, curLayout){
    if (topicCount >= 5 && curLayout !== 'topics-hero') return 'topics-hero';
    if (topicCount === 0 && curLayout !== 'news-hero') return 'news-hero';
    return curLayout || 'today-hero';
  }


  /* ---------- 실시간 날씨 → 배경 하늘(경보) 자동 판정 ----------
     사용자가 "비가 안 와서 미리보기 버튼만 눌러봤다"고 확인하지 못하던 문제:
     판정 함수를 UI와 분리해 실측(날씨코드·강수량·미세먼지·기온)만으로 결정하게 하고,
     아래 decideSky() 가 수동 미리보기보다 실측을 우선하도록 합친다. */
  const WX = {
    storm: /뇌우|천둥|번개|thunder/i,
    rain:  /비|소나기|이슬비|drizzle|rain/i,
    snow:  /눈|소낙눈|snow|sleet/i,
    dust:  /황사|미세먼지|sand|dust/i,
  };
  /* w: 서버 weather payload {code,cond,precip,rainPct,pm10,temp,feels} */
  function skyAlertFromWeather(w){
    if (!w) return null;
    const code = Number(w.code != null ? w.code : w.icon);
    const cond = String(w.cond || '');
    const mm = Number(w.precip || 0);
    const pct = Number(w.rainPct != null ? w.rainPct : 0);
    const pm = Number(w.pm10 != null ? w.pm10 : 0);
    const t = Number(w.temp != null ? w.temp : NaN);
    if (WX.storm.test(cond) || (code >= 95 && code <= 99)) return 'storm';
    if (WX.snow.test(cond) || (code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (WX.rain.test(cond) || mm >= 0.1 || (pct >= 60 && (code >= 51 && code <= 67 || code >= 80 && code <= 82))) return 'rain';
    if (pm >= 150) return 'dust';                       // 매우 나쁨 이상 → 황사·미세먼지 하늘
    if (!isNaN(t) && t >= 35) return 'heat';            // 폭염 수준
    if (!isNaN(t) && t <= -12) return 'cold';           // 한파 수준
    return null;
  }
  /* 수동 미리보기(state.skyMode)와 실측을 합친다.
     - auto: 실측 경보가 있으면 그 하늘, 없으면 시간대 하늘
     - 수동 선택: 선택을 존중(프리뷰 용도)하되, 실측 경보가 'clear'로 돌아오면 자동으로 되돌아간다 */
  function decideSky(mode, alert, hour){
    const m = mode || 'auto';
    const isAlert = !!ALERT_KEYS[m];
    if (m !== 'auto' && m !== 'clear' && !isAlert) return { base: m, weath: null, manual: 1, auto: 0 };  // 낮·노을·밤 고정
    if (isAlert) return { base: m, weath: m, manual: 1, auto: 0 };                                       // 수동 미리보기(경보)
    if (alert) return { base: alert, weath: alert, manual: 0, auto: 1 };                                 // ← 실측으로 자동 전환
    return { base: skyKeyByHour(hour), weath: null, manual: 0, auto: 0 };
  }
  const ALERT_KEYS = { rain:1, storm:1, dust:1, heat:1, cold:1, snow:1 };
  function skyKeyByHour(h){
    if (h >= 5 && h < 8)  return 'dawn';
    if (h >= 8 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'sunset';
    if (h >= 19 && h < 22) return 'dusk';
    return 'night';
  }
  const SKY_ALERT_LABEL = { rain:'비', storm:'뇌우·폭풍', snow:'눈', dust:'미세먼지·황사', heat:'폭염', cold:'한파' };

  /* ---------- 뉴스레터 읽음 큐 — good! = 그 기사를 읽었으므로 같은 관심사의 다음 기사로 ---------- */
  function readKey(tid, id){ return String(tid) + '|' + String(id); }
  function pickUnread(items, muted, read, tid){
    const list = items || [];
    const m = muted || [], r = read || [];
    const alive = list.filter(it => !m.includes(it.id));
    if (!alive.length) return { item: null, exhausted: list.length === 0, allRead: false };
    const unread = alive.filter(it => !r.includes(readKey(tid, it.id)));
    if (unread.length) return { item: unread[0], read: alive.length - unread.length, total: alive.length };
    return { item: null, allRead: true, read: alive.length, total: alive.length };
  }
  /* 읽음 표시 후 무엇을 할지: 다음 기사로 갈지(next), 새로 수집할지(fetch), 순환할지(cycle) */
  function advanceAfterRead(items, muted, read, tid){
    const p = pickUnread(items, muted, read, tid);
    if (p.item) return { action: 'next', item: p.item, read: p.read, total: p.total };
    if (p.allRead) return { action: 'fetch', read: p.read, total: p.total };
    return { action: 'empty' };
  }

  /* ---------- 관심사 빠른 추가용 추천 (추가 버튼/빈 화면/관리창) ----------
     실제로 라이브 소스(RSS)가 수집되는 관심사만 추천한다. 시세·날씨처럼
     “가짜 숫자”로 채워지는 데이터형은 실시간 소스 연결 전까지 추천하지 않는다. */
  const TOPIC_SUGGESTIONS = [
    { label:'맨시티 축구',      kind:'news', cfg:{ preset:'trend' } },
    { label:'비트코인 뉴스',    kind:'news', cfg:{ preset:'trend' } },
    { label:'마인크래프트',     kind:'news', cfg:{ preset:'trend' } },
    { label:'조류 관찰(버드워칭)', kind:'news', cfg:{ preset:'trend' } },
  ];

  /* ---------- 피드백 자연어 처리 (키워드 규칙) ---------- */
  function planFromFeedback(text, topics){
    topics = topics || [];
    const t = text.toLowerCase().replace(/\s+/g,' ');
    const plan = { rules:[], toast:null, ask:null, note:'', layout:null };
    const has = (...ks) => ks.some(k => t.includes(k));

    if (has('어둡게','다크','야간','어두운') && !has('밝게','밝은','환하게')){
      plan.rules.push({ t:'theme', v:'dark', log:'어두운 테마로 전환 (자동 테마 일시 해제)' });
    } else if (has('밝게','라이트','환하게','밝은','낮모드')){
      plan.rules.push({ t:'theme', v:'light', log:'밝은 테마로 전환' });
    }

    if (has('주식','종목','코스피','차트') && has('초록','그린','미국식','해외식','유럽식')){
      plan.rules.push({ t:'stockColor', v:'us', log:'상승=초록·하락=빨강(미국식) 표시로 변경' });
    } else if (has('주식','종목','코스피') && has('빨간','빨강')){
      plan.rules.push({ t:'stockColor', v:'kr', log:'상승=빨강·하락=파랑(한국식) 표시 유지' });
    }

    if (has('글자','글씨') && has('크게','커지','확대')){
      plan.rules.push({ t:'scale', v:0.06, log:'글자를 6% 키워 표시' });
    } else if (has('글자','글씨') && has('작게','작아','축소')){
      plan.rules.push({ t:'scale', v:-0.06, log:'글자를 6% 줄여 표시' });
    }

    if (has('심플','간결','깔끔','단순','복잡','지저분','정돈','정리','많아','넘쳐','압축','간단')){
      plan.rules.push({ t:'clean', log:'표시를 압축: 보조 문구·꾸밈 요소를 접고 핵심만 강조' });
    }

    /* 주제 우선순위: "XX를 맨 위에/먼저/제일 위" */
    if (topics.length){
      const target = topics.find(tp => {
        const short = tp.label.toLowerCase();
        return t.includes(short) || short.split(/[\s·]/).some(w => w.length>=2 && t.includes(w));
      });
      if (target && (has('맨 위','위로','먼저','첫 번째','제일 앞','앞에','순서'))){
        plan.rules.push({ t:'topicTop', tid:target.id, label:target.label,
          log:`관심사 <b>${target.label}</b>을 맨 앞 순서로 배치 → 브리핑/카드도 01번부터 갱신` });
      }
    }

    if (has('일정') && has('왼쪽','크게','위로','맨 위')){
      plan.layout = 'today-hero'; plan.rules.push({ t:'layout', log:'‘오늘 일정’을 좌측 대형 자리로 배치' });
    }
    if (has('관심사','카드','타일') && has('왼쪽','크게','위로')){
      plan.layout = 'topics-hero'; plan.rules.push({ t:'layout', log:'‘관심사 카드’를 좌측 대형 자리로 배치' });
    }
    if (has('브리핑','뉴스','기사') && has('왼쪽','크게','위로','메인')){
      plan.layout = 'news-hero'; plan.rules.push({ t:'layout', log:'‘Today’s Briefing’을 좌측 대형 자리로 배치' });
    }
    if (has('주식','종목') && has('빼','삭제','없애','지워','싫어')){
      plan.ask = '브리핑 위젯에서 "관심없음"을 누르면 그 주제 소식을 편집자가 다른 걸로 교체해요. 여기서는 다른 변경을 원하셨을까요?';
    }
    if (has('칸') && has('어디','아니','또')){
      plan.ask = plan.ask || '이 피드백 반영 칸은 보드의 어느 요소든 고치기 위한 통로예요. 바꾸고 싶은 걸 자유롭게 적어주세요.';
    }
    if (!plan.rules.length && !plan.layout && (t.trim().length <= 6)){
      plan.ask = '어떤 부분을 어떻게 바꿀지 조금 더 알려주세요. 예: “글자 크게”, “다크 모드로”, “비트코인을 맨 위에”';
    }
    plan.note = (plan.rules.length + (plan.layout?1:0)) + '가지 변경 예정';
    return plan;
  }

  global.Logic = { LAYOUTS, decideLayout, planFromFeedback, TOPIC_SUGGESTIONS,
    skyAlertFromWeather, decideSky, ALERT_KEYS, SKY_ALERT_LABEL, readKey, pickUnread, advanceAfterRead };
})(window);
