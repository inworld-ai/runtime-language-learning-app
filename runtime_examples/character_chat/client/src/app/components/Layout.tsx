import { Box, CssBaseline } from '@mui/material';
import { ReactNode } from 'react';

import { Main } from './Main';

interface LayoutProps {
  children?: ReactNode;
}

export function Layout(props: LayoutProps) {
  return (
    <Box>
      <CssBaseline />
      <Main>
        <Box sx={{ maxWidth: '1200px', mx: 'auto' }}>{props.children}</Box>
      </Main>
    </Box>
  );
}
