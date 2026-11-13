import type { ReactNode } from 'react'
import { ChakraProvider } from '@chakra-ui/react'
import { system } from '../../theme.ts'

export function Provider(props: { children: ReactNode }) {
  return <ChakraProvider value={system}>{props.children}</ChakraProvider>
}
