import { useState } from 'react'
import type { FormEvent } from 'react'
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey, ProblemError } from '../../api/errors.ts'
import { FieldInput, FormField } from '../../components/ui/form-field.tsx'
import { Lamp } from '../../components/ui/lamp.tsx'
import { LanguageSelector } from '../../components/ui/language-selector.tsx'
import { LoadingScreen } from '../../components/ui/loading-screen.tsx'
import { usePageTitle } from '../../components/ui/page-title.ts'
import { PasswordField } from '../../components/ui/password-field.tsx'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { Redirect } from '../../components/ui/route-arrival.tsx'
import i18n from '../../i18n/index.ts'
import { safeNextPath } from './next-path.ts'
import { useLogin, useSession } from './use-auth.ts'

export function LoginPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeNextPath(searchParams.get('next'))
  // Also primes the XSRF-TOKEN cookie the login POST has to echo.
  const session = useSession()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Set by a submit with a blank field, so the reader learns which one before any request.
  const [blank, setBlank] = useState<{ email: boolean; password: boolean }>()
  usePageTitle(t('login.pageTitle'))

  // A session probe that failed after a signed-in visit keeps its old data, so
  // only a successful probe counts as signed in. That leftover data is how the
  // page knows the session ended rather than never began.
  // Signing in just now is the reader's doing; a session that was already live skips the page.
  if (session.isSuccess)
    return login.isSuccess ? <Navigate replace to={next} /> : <Redirect to={next} />
  if (session.isPending) return <LoadingScreen />
  const sessionEnded = session.data !== undefined

  const invalidCredentials = login.error instanceof ProblemError && login.error.status === 401
  const problem = login.error
    ? t(invalidCredentials ? 'login.invalidCredentials' : fallbackErrorKey(login.error))
    : undefined

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const missing = { email: email.trim() === '', password: password === '' }
    if (missing.email || missing.password) {
      login.reset()
      setBlank(missing)
      return
    }
    setBlank(undefined)
    login.mutate(
      { email, password },
      {
        onSuccess: (user) => {
          void i18n.changeLanguage(user.language)
          void navigate(next, { replace: true })
        },
      },
    )
  }

  return (
    // The card hangs from a fixed offset rather than centring, so the errors a submit adds grow
    // downward and the mark and heading above them stay put.
    <Flex
      justify="center"
      align="flex-start"
      minH="100vh"
      px="24px"
      pb="24px"
      pt="clamp(24px, 24vh, 240px)"
      bg="bg"
    >
      <Box
        bg="bg.panel"
        borderWidth="ink"
        borderColor="border.control"
        borderRadius="panel"
        boxShadow="raised"
        p="28px"
        w="full"
        maxW="380px"
      >
        <Flex align="center" gap="12px" mb="6px">
          {/* The course's mark: three lamps, one of each signal. */}
          <Flex gap="4px" aria-hidden="true">
            <Lamp tone="red" size="10px" />
            <Lamp tone="amber" size="10px" />
            <Lamp tone="green" size="10px" />
          </Flex>
          <Heading
            as="h1"
            fontSize="48px"
            lineHeight="0.9"
            fontWeight="normal"
            textTransform="uppercase"
            letterSpacing="0.01em"
          >
            {t('app.name')}
          </Heading>
        </Flex>
        <Text color="fg.muted" fontSize="14px" mb="20px">
          {t('login.subtitle')}
        </Text>
        {sessionEnded && (
          <Text
            role="status"
            bg="bg.muted"
            borderRadius="control"
            px="12px"
            py="10px"
            mb="18px"
            fontSize="14px"
          >
            {t('login.sessionEnded')}
          </Text>
        )}
        <form onSubmit={onSubmit} noValidate>
          <FormField
            id="login-email"
            label={t('login.email')}
            error={blank?.email ? t('errors.field.required') : undefined}
            invalid={invalidCredentials}
          >
            {(aria) => (
              <FieldInput
                {...aria}
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </FormField>
          <Box mt="14px">
            <PasswordField
              id="login-password"
              label={t('login.password')}
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              error={blank?.password ? t('errors.field.required') : undefined}
              invalid={invalidCredentials}
            />
          </Box>
          <ProblemText error={problem} />
          <Button type="submit" w="full" mt="20px" colorPalette="accent" disabled={login.isPending}>
            {t('login.submit')}
          </Button>
        </form>
        <Flex justify="flex-end" mt="18px">
          <LanguageSelector />
        </Flex>
      </Box>
    </Flex>
  )
}
