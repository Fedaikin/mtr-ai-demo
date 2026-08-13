import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { getDemoSession } from "@/lib/session";

export const metadata: Metadata = { title: "Справка" };
export const dynamic = "force-dynamic";

const sections = [
  { path: "/", title: "Обзор", text: "Стартовый экран, адаптированный под текущую роль: личные задачи, состояние команды или управленческие KPI.", roles: "Все проектные роли" },
  { path: "/analytics", title: "Общая аналитика", text: "Динамика запасов и расхода, обработка спецификаций, загрузка, SLA и прогнозы с ролевой детализацией.", roles: "Все проектные роли" },
  { path: "/catalog", title: "Промышленный каталог", text: "Карточки МТР, подтверждённые семейства замен, BOM и разрешённые сведения об остатках.", roles: "Участники проекта" },
  { path: "/specifications", title: "Спецификации", text: "Версии проектных спецификаций, позиции и безопасный импорт файлов в проектный контур.", roles: "Просмотр — всем; импорт — аналитику и менеджеру" },
  { path: "/mtr-analysis", title: "МТР-анализ", text: "Ответственность по позициям, Даблчекер МТР и полный отчёт с источниками и объяснениями.", roles: "По проектным полномочиям" },
  { path: "/admin/scenarios", title: "Сценарии и запуски", text: "Запуск анализа, мониторинг этапов, повтор и отмена в пределах разрешений пользователя.", roles: "Аналитик, эксперт, менеджер; настройка — администратор" },
  { path: "/pulse", title: "Пульс МТР", text: "Оперативная лента событий спецификаций, запусков, решений и ответов агента.", roles: "Проектные роли" },
  { path: "/admin/*", title: "Администрирование", text: "Пользователи, роли, интеграции, промпты, словари, логи агента и аудит.", roles: "Администратор, менеджер или аудитор — по разделу" },
] as const;

const processes = [
  { number: "01", title: "Подготовить спецификацию", text: "Проверьте версию, состав позиций и источник. При импорте сначала выполняется валидация, затем публикация в проект." },
  { number: "02", title: "Запустить анализ", text: "Выберите сценарий. Система загрузит данные Appius, синхронизирует SAP, определит ответственность, проверит остатки и найдёт аналоги." },
  { number: "03", title: "Провести Даблчек", text: "Неоднозначные или критичные позиции поступают в экспертную очередь. Решение человека требует причины и фиксируется в аудите." },
  { number: "04", title: "Проверить и опубликовать отчёт", text: "Сопоставьте выводы с citations, устраните незавершённые проверки и только после этого публикуйте итоговый отчёт." },
] as const;

const scenarios = [
  { role: "Специалист", goal: "Обработать новую спецификацию", steps: "Спецификации → импорт → Сценарии и запуски → МТР-анализ → передача спорных позиций эксперту." },
  { role: "Эксперт", goal: "Принять решение по спорной позиции", steps: "Экспертная очередь → изучение независимых доказательств → решение с обязательным обоснованием." },
  { role: "Менеджер", goal: "Снять узкое место команды", steps: "Обзор → Общая аналитика → проверка загрузки и SLA → перераспределение задач → контроль отчёта." },
  { role: "Руководитель", goal: "Оценить риски обеспечения", steps: "Обзор → Общая аналитика → критические риски → прогноз дефицита → выбор варианта решения." },
  { role: "Администратор / аудитор", goal: "Проверить управляемость контура", steps: "Логи агента и аудит → проверка событий, permissions и версий конфигурации без чтения закрытых личных данных." },
] as const;

const promptExamples = [
  { title: "Найти остаток", prompt: "Покажи доступный остаток позиции CAT-DEMO-PIP-0005 и укажи дату снимка данных." },
  { title: "Проверить замену", prompt: "Найди подтверждённые аналоги для задвижки из текущей спецификации. Перечисли совпадения и отклонения." },
  { title: "Объяснить решение", prompt: "Почему эта позиция отнесена к ответственности Заказчика? Приведи документ, версию и пункт." },
  { title: "Оценить риск", prompt: "Какие позиции текущего отчёта имеют риск дефицита и требуют решения человека в первую очередь?" },
  { title: "Собрать сводку", prompt: "Составь краткую сводку по завершённому запуску: найдено на складе, предложено аналогов, отправлено на экспертизу." },
  { title: "Уточнить ограничение", prompt: "Каких данных не хватает для уверенного вывода по этой позиции и что нужно проверить вручную?" },
] as const;

export default async function HelpPage() {
  await getDemoSession();
  return <>
    <PageHeader eyebrow="Центр знаний" title="Справка" description="Устройство прототипа, назначение разделов, рабочие процессы и практические примеры работы с МТО-агентом." />

    <nav aria-label="Разделы справки" className="mb-6 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {[['architecture', 'Устройство'], ['sections', 'Разделы'], ['processes', 'Процессы'], ['scenarios', 'Сценарии'], ['agent', 'МТО-агент']].map(([id, label]) => <a key={id} href={`#${id}`} className="focus-ring rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800">{label}</a>)}
    </nav>

    <section id="architecture" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle eyebrow="Устройство" title="Как работает прототип" text="Это демонстрационный контур поддержки решений по материально-техническим ресурсам. Он объединяет синтетические данные и сохраняет решение за человеком." /><div className="mt-5 grid gap-4 lg:grid-cols-4"><ArchitectureCard number="01" title="Источники" text="Appius PLM, SAP S/4HANA, нормативный RAG и промышленный каталог." /><ArchitectureCard number="02" title="Аналитический конвейер" text="Классификация ответственности, проверка остатков, поиск аналогов и прогноз." /><ArchitectureCard number="03" title="МТО-агент" text="Отвечает только по доступным данным, приводит источники и отмечает неопределённость." /><ArchitectureCard number="04" title="Решение человека" text="Эксперт подтверждает спорные выводы, менеджер публикует результат, аудит хранит историю." /></div><div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>Граница прототипа.</strong> Система не создаёт закупку, резерв, договорное обязательство или окончательное инженерное решение. Все данные синтетические, а критичные выводы требуют проверки человеком.</div></section>

    <section id="sections" className="mt-6 scroll-mt-6"><SectionTitle eyebrow="Навигация" title="Назначение разделов" text="Состав меню и детализация данных автоматически меняются по RBAC. Прямой URL не расширяет полномочия." /><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sections.map((section) => <article key={section.path} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-950">{section.title}</h3><code className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{section.path}</code></div><p className="mt-3 text-sm leading-6 text-slate-600">{section.text}</p><p className="mt-4 border-t border-slate-100 pt-3 text-xs text-teal-800"><strong>Доступ:</strong> {section.roles}</p></article>)}</div></section>

    <section id="processes" className="mt-6 scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle eyebrow="Сквозной процесс" title="От спецификации до итогового отчёта" text="Обычный рабочий цикл состоит из четырёх контролируемых этапов." /><ol className="mt-5 grid gap-4 lg:grid-cols-4">{processes.map((process) => <li key={process.number} className="rounded-lg border border-slate-200 p-4"><span className="font-mono text-xs font-semibold text-teal-700">{process.number}</span><h3 className="mt-2 font-semibold">{process.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{process.text}</p></li>)}</ol></section>

    <section id="scenarios" className="mt-6 scroll-mt-6"><SectionTitle eyebrow="По ролям" title="Основные пользовательские сценарии" text="Начинайте с цели своей роли и переходите только в доступные вам рабочие разделы." /><div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Роль</th><th className="px-5 py-3">Цель</th><th className="px-5 py-3">Маршрут</th></tr></thead><tbody className="divide-y divide-slate-100">{scenarios.map((scenario) => <tr key={scenario.role}><td className="px-5 py-4 font-semibold text-teal-800">{scenario.role}</td><td className="px-5 py-4 font-medium">{scenario.goal}</td><td className="px-5 py-4 leading-6 text-slate-600">{scenario.steps}</td></tr>)}</tbody></table></div></div></section>

    <section id="agent" className="mt-6 scroll-mt-6 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-950 to-slate-950 p-5 text-white shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-300">МТО-агент</p><h2 className="mt-2 text-2xl font-semibold">Как получить полезный и проверяемый ответ</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">В интерфейсе помощник обозначен как «МТР-агент». Он работает в рамках прав текущего пользователя: не раскрывает скрытые склады, чужие личные чаты, системные промпты или недоступные документы.</p><div className="mt-5 grid gap-4 lg:grid-cols-3"><AgentRule title="Дайте контекст" text="Укажите код позиции, спецификацию, запуск или отчёт. Чем точнее объект, тем проверяемее ответ." /><AgentRule title="Сформулируйте результат" text="Попросите остаток, варианты замены, объяснение ответственности, оценку риска или сводку." /><AgentRule title="Запросите доказательства" text="Просите дату снимка, документ, версию, пункт и явно отмеченные ограничения данных." /></div><div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4"><h3 className="font-semibold">Шаблон хорошего запроса</h3><p className="mt-2 font-mono text-sm leading-6 text-teal-100">Для [объект/код] выполни [задачу]. Используй данные [источник/период]. Покажи [формат результата], приведи citations и отдельно укажи неопределённость и необходимость решения человека.</p></div></section>

    <section className="mt-6"><SectionTitle eyebrow="Практика" title="Примеры запросов к МТО-агенту" text="Примеры можно адаптировать под доступную вам спецификацию, позицию или запуск." /><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{promptExamples.map((example) => <article key={example.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{example.title}</p><p className="mt-3 text-sm leading-6 text-slate-700">«{example.prompt}»</p></article>)}</div></section>

    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle eyebrow="Проверка ответа" title="Перед использованием результата" text="Короткий контрольный список помогает не принять демонстрационный вывод за подтверждённый факт." /><ul className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2"><Checklist text="Проверьте код, версию спецификации и дату снимка данных." /><Checklist text="Откройте приведённые citations и сопоставьте их с выводом." /><Checklist text="Отделите прямое совпадение от аналога с допустимыми отклонениями." /><Checklist text="Передайте спорную или критичную позицию на экспертную проверку." /></ul></section>
  </>;
}

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{title}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{text}</p></div>; }
function ArchitectureCard({ number, title, text }: { number: string; title: string; text: string }) { return <article className="rounded-lg border border-slate-200 bg-slate-50 p-4"><span className="font-mono text-xs font-semibold text-teal-700">{number}</span><h3 className="mt-2 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>; }
function AgentRule({ title, text }: { title: string; text: string }) { return <article className="rounded-lg border border-white/10 bg-white/5 p-4"><h3 className="font-semibold text-teal-100">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-300">{text}</p></article>; }
function Checklist({ text }: { text: string }) { return <li className="flex gap-3 rounded-lg bg-slate-50 p-3"><span aria-hidden="true" className="mt-0.5 text-teal-700">✓</span><span>{text}</span></li>; }
