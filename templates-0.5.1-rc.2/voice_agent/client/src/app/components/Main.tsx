import { styled } from '@mui/material/styles';

export const Main = styled('main')(({ theme }) => ({
  marginTop: '0.3rem',
  padding: theme.spacing(1),
  transition: theme.transitions.create('margin', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  [theme.breakpoints.down('sm')]: {
    marginTop: '1.5rem',
  },
  [theme.breakpoints.down('md')]: {
    width: '100%',
    marginLeft: 0,
    padding: theme.spacing(2),
  },
}));
