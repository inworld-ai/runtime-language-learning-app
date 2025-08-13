import { alpha, Box, Stack, styled } from '@mui/material';
import { keyframes } from '@mui/system';

export const HistoryStyled = styled(Box)(() => ({
  width: '100%',
  height: '100%',
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingTop: '4rem',

  '&.history--avatar-view': {
    '& .history--avatar-list': {
      '& .history-message-group': {
        display: 'none',
        '&:nth-last-of-type(1)': {
          display: 'flex',
        },
        '&:nth-last-of-type(2)': {
          display: 'flex',
        },
      },
    },
  },
}));

export const HistoryInner = styled(Stack)(() => ({
  justifyContent: 'flex-end',
  width: '100%',
  minHeight: '100%',
}));

export const HistoryMessageGroup = styled('ul')(({ theme }) => ({
  marginBottom: '8px',
  padding: 0,
  flexDirection: 'column',
  paddingLeft: '1rem',
  paddingRight: '1rem',

  '& .chat__bubble': {
    marginBottom: '2px',
    borderRadius: '1rem',
    color: theme.palette.text.primary,
  },

  '&.history-message-group--AGENT': {
    '& li:last-child .chat__bubble': {
      borderBottomLeftRadius: '0',
    },
    '& li:first-of-type .chat__bubble': {
      borderTopLeftRadius: '1rem',
      borderTopRightRadius: '1rem',
    },
    '& .history-actor': {
      borderBottomLeftRadius: 0,
      color: theme.palette.text.secondary,
      background: theme.palette.background.paper,
    },
  },

  '&.history-message-group--USER': {
    '& li': {
      justifyContent: 'flex-end',
    },
    '& .history-actor': {
      borderBottomRightRadius: 0,
    },
  },
}));

export const HistoryAction = styled('span')(() => ({
  fontStyle: 'italic',
  fontWeight: 600,
}));

export const HistoryActor = styled('li')(() => ({
  listStyleType: 'none',
  display: 'flex',
  flexDirection: 'row',
  width: '100%',
  '& p': {
    fontSize: '0.875rem',
  },
}));

export const HistoryItemMessageActor = styled(Box)(({ theme }) => ({
  flex: '1 1 100%',
  whiteSpace: 'pre-wrap',
  padding: theme.spacing(1.5),
  borderRadius: '0.75rem',
  background: theme.palette.primary.main,
  color: 'white',
  fontFamily: 'DM Sans',
  position: 'relative',
  overflow: 'visible',
}));

export const ActionsStyled = styled(Stack)(({ theme }) => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap: theme.spacing(),
  backgroundColor: alpha(theme.palette.background.paper, 0.4),
  backdropFilter: 'blur(12px)',
  position: 'absolute',
  width: '100%',
  bottom: '0',
  left: '0',
  columnGap: '0.25rem',
  padding: '0.75rem',
  boxShadow: `0px -4px 12px rgba(0, 0, 0, 0.25)`,
  [theme.breakpoints.only('xs')]: {
    backgroundColor: theme.palette.background.default,
    borderRadius: '0',
    padding: '0.5rem',
    paddingBottom: '0',
  },
}));

export const RecordIcon = styled('div')(({ theme }) => {
  const pulseKeyframe = keyframes`
    0% {
      background-color: ${theme.palette.error.dark}
    }
    50% {
      background-color: ${theme.palette.error.light}
    }
    100% {
      background-color: ${theme.palette.error.dark}
    }
  `;

  return {
    display: 'flex',
    position: 'relative',

    '&:before': {
      content: '""',
      display: 'block',
      width: theme.spacing(2),
      height: theme.spacing(2),
      borderRadius: '50%',
      backgroundColor: alpha(theme.palette.error.main, 0.4),
    },

    '&:after': {
      content: '""',
      display: 'block',
      position: 'absolute',
      top: theme.spacing(0.5),
      left: theme.spacing(0.5),
      width: theme.spacing(),
      height: theme.spacing(),
      borderRadius: '50%',
      backgroundColor: theme.palette.error.main,
      animation: `${pulseKeyframe} 1.5s ease-in-out 0.5s infinite`,
    },
  };
});
