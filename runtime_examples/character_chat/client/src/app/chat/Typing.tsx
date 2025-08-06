import styled from '@emotion/styled';
import { Box } from '@mui/material';
import { keyframes } from '@mui/system';

import { INWORLD_COLORS } from '../colors';

// TODO: make configurable with storybook introduction
const SIZE = 4;
const DURATION = 1.4;

const dotAnimation = keyframes`
  0% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-${SIZE}px);
  }
  40% {
    transform: translateY(0);
  }
`;

const Dot = styled.div<{ delay: number }>`
  border-radius: ${SIZE / 2}px;
  width: ${SIZE}px;
  height: ${SIZE}px;
  margin: ${SIZE}px ${SIZE}px ${SIZE}px 0px;
  animation: ${dotAnimation} ${DURATION}s ease-in infinite;
  animation-delay: ${({ delay }) => `${delay}s`};
  background-color: ${INWORLD_COLORS.warmGray[50]};
`;

export const Typing = () => {
  return (
    <Box display="flex">
      <Dot delay={0} />
      <Dot delay={DURATION * 0.25} />
      <Dot delay={DURATION * 0.5} />
    </Box>
  );
};
