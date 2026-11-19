import { useEffect, useId, useState, type ReactNode } from 'react'
import { Box, Grid, Text, VisuallyHidden } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey } from '../../api/errors.ts'
import { RouteError } from '../../components/ui/route-error.tsx'
import { PageHeader } from '../../components/ui/page-header.tsx'
import { Panel, PanelHead } from '../../components/ui/panel.tsx'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { SegmentedToggle } from '../../components/ui/segmented-toggle.tsx'
import { TOUCH_FLOOR } from '../../components/ui/control-style.ts'
import { useSession } from '../auth/use-auth.ts'
import { DataFlowWindow, FLOW_BESIDE } from './settings-flow.tsx'
import {
  useChangeChatSettings,
  useChatModels,
  useChatSettings,
  type ChatSettings,
} from './use-chat-settings.ts'

type Half = 'on' | 'off'

/** Every stored setting; each has a panel of its own. */
type Setting = keyof ChatSettings

/** The settings stored as On or Off. */
type Switch = {
  [K in Setting]: ChatSettings[K] extends boolean ? K : never
}[Setting]

/** Each panel's bundle prefix under `settings`. */
const SETTING_KEYS: Record<Setting, string> = {
  model: 'settings.model',
  appTracesExported: 'settings.traces',
  gatewayTracesJoined: 'settings.join',
  appLlmSpansExported: 'settings.llmSpans',
}

/**
 * Every sentence a switch can show, as keys under its prefix. They are all
 * rendered, stacked in one cell, so the sentence box is as tall as the longest
 * in every language and width and switching moves nothing below.
 */
const SENTENCES: Record<Switch, readonly string[]> = {
  appTracesExported: ['offSentence', 'onSentence'],
  gatewayTracesJoined: ['offSentence', 'onSentence', 'lockedSentence'],
  appLlmSpansExported: ['offSentence', 'onSentence', 'lockedSentence'],
}

/**
 * Grouping LiteLLM's calls changes nothing while the app's spans group each question into a trace, and the app's
 * LLM spans change nothing while the app sends no spans at all.
 */
const isLocked = (name: Switch, stored: ChatSettings | undefined) =>
  (name === 'gatewayTracesJoined' && stored?.appTracesExported === true) ||
  (name === 'appLlmSpansExported' && stored?.appTracesExported === false)

/** The sentence a stored switch shows; none while the settings load. */
function shownSentence(name: Switch, stored: ChatSettings | undefined): string | undefined {
  if (stored === undefined) return undefined
  if (isLocked(name, stored)) return 'lockedSentence'
  return stored[name] ? 'onSentence' : 'offSentence'
}

/** A group of panels under a name, such as the switches that decide what Phoenix receives. */
function SettingsGroup(props: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <Box role="group" aria-labelledby={headingId} mb="8px">
      <Text
        id={headingId}
        mb="10px"
        fontFamily="mono"
        fontSize="11px"
        fontWeight="semibold"
        lineHeight="16px"
        letterSpacing="0.06em"
        textTransform="uppercase"
        color="fg.muted"
      >
        {props.title}
      </Text>
      {props.children}
    </Box>
  )
}

/** The aliases offered: the configured ones in order, and a stored one no longer configured after them. */
function modelChoices(models: readonly string[], stored: ChatSettings | undefined): string[] {
  if (stored === undefined || models.includes(stored.model)) return [...models]
  return [...models, stored.model]
}

/** How long the line under a toggle says it was saved before it goes quiet again. */
const SAVED_MS = 5000

/** The support-only settings page: the LiteLLM alias the chat asks, whether the app sends its own spans to Phoenix, whether LiteLLM's calls of one question share a trace without them, and whether the app's model span is an LLM span counting the tokens beside LiteLLM's. */
export function SettingsPage() {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const settings = useChatSettings()
  const models = useChatModels()
  const change = useChangeChatSettings()
  // The setting the reader changed last: the one whose panel says saving, saved or not saved.
  const [touched, setTouched] = useState<Setting>()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), SAVED_MS)
    return () => clearTimeout(timer)
  }, [saved])

  const header = <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

  // Only settings that never loaded give way to the failure; a failed refetch keeps the view.
  if (settings.isLoadingError) {
    return (
      <>
        {header}
        <ProblemText
          flush
          error={tCommon(fallbackErrorKey(settings.error))}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
        />
      </>
    )
  }

  const stored = settings.data

  /**
   * Saves one setting and nothing else, so a value someone else changed since this page loaded stays as they left
   * it; a press while a save runs, or before the settings loaded, is ignored.
   */
  const save = <K extends Setting>(name: K, value: ChatSettings[K]) => {
    if (change.isPending || stored === undefined) return
    setTouched(name)
    setSaved(false)
    change.mutate({ [name]: value }, { onSuccess: () => setSaved(true) })
  }

  const isSaving = (name: Setting) => touched === name && change.isPending

  /** The reserved saving or saved line of a panel, and its problem when the save failed; `state` is what is still stored. */
  const feedback = (name: Setting, state: string) => {
    const mine = touched === name
    const saving = isSaving(name)
    const lineKey = saving ? 'settings.saving' : mine && saved ? 'settings.saved' : undefined
    return (
      <>
        {/* A reserved line, so saving and saved move nothing; the live region below announces the result. */}
        <Text
          aria-hidden={lineKey === undefined ? true : undefined}
          data-state={saving ? 'saving' : lineKey === undefined ? undefined : 'saved'}
          mt="8px"
          minH="16px"
          fontSize="12px"
          lineHeight="16px"
          color={saving ? 'fg.muted' : 'fg'}
        >
          {lineKey === undefined ? undefined : t(lineKey)}
        </Text>
        {mine && change.isError && (
          <ProblemText
            error={`${t('settings.notSaved', {
              title: t(`${SETTING_KEYS[name]}.title`),
              state,
            })} ${tCommon(fallbackErrorKey(change.error))}`}
          />
        )}
      </>
    )
  }

  const modelPanel = () => {
    const choices = modelChoices(models.data?.models ?? [], stored)
    return (
      <Panel as="section" maxW="640px" aria-labelledby="model-heading">
        <PanelHead id="model-heading" title={t('settings.model.title')} />
        {/* Holds the toggle's height while the aliases load, so nothing below moves when they arrive. */}
        <Box minH="40px" css={TOUCH_FLOOR}>
          {choices.length > 0 && (
            <SegmentedToggle<string>
              label={t('settings.model.title')}
              options={choices.map((model) => ({ value: model, label: model }))}
              value={stored?.model}
              describedBy="model-sentence"
              busy={isSaving('model')}
              onChange={(model) => save('model', model)}
            />
          )}
        </Box>
        <Text id="model-sentence" mt="14px" maxW="60ch" textWrap="pretty">
          {t('settings.model.sentence')}
        </Text>
        {feedback('model', stored?.model ?? '')}
        {models.isLoadingError && (
          <ProblemText
            error={`${t('settings.model.notLoaded')} ${tCommon(fallbackErrorKey(models.error))}`}
            onRetry={() => void models.refetch()}
            retrying={models.isFetching}
          />
        )}
      </Panel>
    )
  }

  const switchPanel = (name: Switch) => {
    const keys = SETTING_KEYS[name]
    const half: Half | undefined = stored === undefined ? undefined : stored[name] ? 'on' : 'off'
    const shown = shownSentence(name, stored)
    const headingId = `${name}-heading`
    const sentenceId = `${name}-sentence`
    return (
      <Panel as="section" maxW="640px" aria-labelledby={headingId}>
        <PanelHead id={headingId} title={t(`${keys}.title`)} />
        <SegmentedToggle<Half>
          label={t(`${keys}.title`)}
          options={[
            { value: 'on', label: t('settings.traces.on') },
            { value: 'off', label: t('settings.traces.off') },
          ]}
          value={half}
          disabled={isLocked(name, stored)}
          describedBy={shown === undefined ? undefined : sentenceId}
          busy={isSaving(name)}
          equal
          onChange={(value) => save(name, value === 'on')}
        />
        <Box mt="14px" maxW="60ch" display="grid">
          {SENTENCES[name].map((sentence) => {
            const active = sentence === shown
            return (
              <Text
                key={sentence}
                id={active ? sentenceId : undefined}
                gridArea="1 / 1"
                textWrap="pretty"
                visibility={active ? 'visible' : 'hidden'}
                aria-hidden={active ? undefined : true}
              >
                {t(`${keys}.${sentence}`)}
              </Text>
            )
          })}
        </Box>
        {feedback(name, half === undefined ? '' : t(`settings.state.${half}`))}
      </Panel>
    )
  }

  /** What the live region says of a saved setting: the model it now asks, or a switch's new sentence. */
  const savedSentence = (name: Setting) => {
    if (stored === undefined) return undefined
    if (name === 'model') return t('settings.model.chosen', { model: stored.model })
    return t(`${SETTING_KEYS[name]}.${shownSentence(name, stored)}`)
  }

  const announced = touched !== undefined && saved ? savedSentence(touched) : undefined

  return (
    <>
      {header}
      {/* The panels first, then what they do: the window follows them in reading order and sits beside them when there is room. */}
      <Box containerType="inline-size" containerName="settings-page">
        <Grid
          templateColumns="minmax(0, 1fr)"
          columnGap="24px"
          alignItems="start"
          css={{ [FLOW_BESIDE]: { gridTemplateColumns: 'minmax(0, 640px) minmax(0, 1fr)' } }}
        >
          <Box minW="0">
            {modelPanel()}
            <SettingsGroup title={t('settings.groups.tracing')}>
              {switchPanel('appTracesExported')}
              {switchPanel('gatewayTracesJoined')}
              {switchPanel('appLlmSpansExported')}
            </SettingsGroup>
          </Box>
          <Box minW="0" css={{ [FLOW_BESIDE]: { alignSelf: 'stretch' } }}>
            <DataFlowWindow settings={settings.data} />
          </Box>
        </Grid>
      </Box>
      {/* One live region for the page: the saved setting's name and its new sentence, said once. */}
      <VisuallyHidden role="status">
        {touched !== undefined && announced !== undefined
          ? t('settings.announcement', {
              title: t(`${SETTING_KEYS[touched]}.title`),
              sentence: announced,
            })
          : undefined}
      </VisuallyHidden>
    </>
  )
}

/** The settings route: support staff only, anyone else gets the not-found page before any settings request. */
export function SettingsRoute() {
  const roles = useSession().data?.roles
  return roles?.includes('SUPPORT') ? <SettingsPage /> : <RouteError notFound />
}
