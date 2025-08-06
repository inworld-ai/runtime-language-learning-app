import { styled } from '@mui/system';

const NAV_HEIGHT_XS = '3rem';
const TAB_BAR_HEIGHT = '3rem';

export const MainWrapper = styled('div')(({ theme }) => ({
  position: 'sticky',
  height: `calc(100vh -1.5rem)`,
  display: 'flex',
  flexDirection: 'column',
  [theme.breakpoints.only('sm')]: {
    paddingLeft: 0,
  },
  [theme.breakpoints.only('xs')]: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    paddingLeft: '0',
    paddingRight: '0',
    paddingBottom: TAB_BAR_HEIGHT,
  },
}));
export const ChatWrapper = styled('div')(({ theme }) => ({
  borderRadius: '1.75rem',
  overflow: 'hidden',
  backgroundColor: theme.palette.background.paper,
  height: `calc(100vh - 1.5rem)`,

  [theme.breakpoints.only('xs')]: {
    height: `calc(100vh - ${NAV_HEIGHT_XS} - ${TAB_BAR_HEIGHT})`,
    borderRadius: 0,
  },
}));

export const SimulatorHeader = styled('div')(({ theme }) => ({
  height: '4rem',
  backgroundColor: theme.palette.background.default,
  backdropFilter: 'blur(12px)',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'absolute',
  top: 0,
  left: 0,
  zIndex: 5,
  [theme.breakpoints.only('xs')]: {
    height: 'auto',
    padding: '0.5rem',
  },
}));
